import assert from 'node:assert/strict';
import test from 'node:test';
import { PaperTradingEngine } from './exchangePaperEngine.js';
import { applyPaperSlippage, estimatePaperSlippageBps, type PaperOrderBook } from './paperSlippage.js';
import type { Player } from './types.js';

const TAKER_FEE_RATE = 0.0004 / 3;
const SPREAD_BPS = 0.1;

function sizeForNotional(price: number, notionalUsd: number): number {
  return notionalUsd / price;
}

function marketRoundTripPnl(
  pair: string,
  price: number,
  notionalUsd: number,
  marketMoveBps: number,
): number {
  const size = sizeForNotional(price, notionalUsd);
  const halfSpread = SPREAD_BPS / 2 / 10_000;
  const entryRequested = price * (1 + halfSpread);
  const exitMid = price * (1 + marketMoveBps / 10_000);
  const exitRequested = exitMid * (1 - halfSpread);
  const entry = applyPaperSlippage(pair, entryRequested, size, 'buy', 'slippage-v1');
  const exit = applyPaperSlippage(pair, exitRequested, size, 'sell', 'slippage-v1');
  const gross = (exit.executionPrice - entry.executionPrice) * size;
  const fees = (entry.executionPrice + exit.executionPrice) * size * TAKER_FEE_RATE;
  return gross - fees;
}

function fakePlayer(): Player {
  return {
    id: 'local-slippage-test',
    name: 'LocalSlippageTest',
    color: '#ffffff',
    avatar: null,
    apiKey: '',
    apiSecret: '',
    traderCode: 'LOCAL',
    active: true,
    initialBalance: 100_000,
    currentBalance: 100_000,
    availableMargin: 100_000,
    usedMargin: 0,
    feesPaid: 0,
    pnl: 0,
    pnlPercent: 0,
    tradeCount: 0,
    trades: [],
    openPositions: [],
    openOrders: [],
    rank: 0,
    previousRank: 0,
    badges: [],
    winStreak: 0,
    longestPositionMinutes: 0,
    biggestTradePnl: 0,
    bestTradePercent: 0,
    lastUpdate: Date.now(),
    connected: true,
    isCompetitionPlayer: true,
  };
}

test('impact is monotonic by notional and respects liquidity tiers', () => {
  const notionals = [100, 10_000, 100_000, 1_000_000, 10_000_000];
  for (const pair of ['BTC/USD', 'SOL/USD', 'TRX/USD', 'BONK/USD']) {
    const impacts = notionals.map((notional) => estimatePaperSlippageBps(pair, notional));
    assert.ok(impacts.every((impact, index) => index === 0 || impact >= impacts[index - 1]));
  }

  for (const notional of notionals) {
    assert.ok(estimatePaperSlippageBps('BTC/USD', notional) < estimatePaperSlippageBps('SOL/USD', notional));
    assert.ok(estimatePaperSlippageBps('SOL/USD', notional) < estimatePaperSlippageBps('TRX/USD', notional));
    assert.ok(estimatePaperSlippageBps('TRX/USD', notional) < estimatePaperSlippageBps('BONK/USD', notional));
  }
});

test('small genuine moves remain tradable while oversized micro-scalps lose', () => {
  assert.ok(marketRoundTripPnl('BTC/USD', 60_000, 10_000, 5) > 0);
  assert.ok(marketRoundTripPnl('TRX/USD', 0.333, 10_000, 10) > 0);
  assert.ok(marketRoundTripPnl('TRX/USD', 0.333, 1_000_000, 10) < 0);
  assert.ok(marketRoundTripPnl('TRX/USD', 0.333, 1_000_000, 100) > 0);
});

test('buy and sell impact is adverse and symmetric without a book', () => {
  for (const [pair, price] of [['BTC/USD', 60_000], ['SOL/USD', 150], ['TRX/USD', 0.333]]) {
    const size = sizeForNotional(Number(price), 1_000_000);
    const buy = applyPaperSlippage(String(pair), Number(price), size, 'buy', 'slippage-v1');
    const sell = applyPaperSlippage(String(pair), Number(price), size, 'sell', 'slippage-v1');
    assert.ok(buy.executionPrice > Number(price));
    assert.ok(sell.executionPrice < Number(price));
    assert.ok(Math.abs(buy.slippageBps - sell.slippageBps) < 1e-9);
  }
});

test('L5 walk uses VWAP, ignores favorable stale prices, and extrapolates overflow', () => {
  const book: PaperOrderBook = {
    asks: [
      { price: 0.3329, volume: 500_000 },
      { price: 0.3331, volume: 500_000 },
      { price: 0.3332, volume: 500_000 },
    ],
    bids: [
      { price: 0.3331, volume: 500_000 },
      { price: 0.3329, volume: 500_000 },
      { price: 0.3328, volume: 500_000 },
    ],
  };
  const buy = applyPaperSlippage('TRX/USD', 0.333, 3_000_000, 'buy', 'slippage-v1', book);
  const sell = applyPaperSlippage('TRX/USD', 0.333, 3_000_000, 'sell', 'slippage-v1', book);

  assert.equal(buy.source, 'itick-l5');
  assert.equal(sell.source, 'itick-l5');
  assert.ok(buy.executionPrice > 0.3332);
  assert.ok(sell.executionPrice < 0.3328);
  assert.ok(buy.executionPrice >= buy.requestedPrice);
  assert.ok(sell.executionPrice <= sell.requestedPrice);
});

test('engine applies the model on both market entry and manual exit', async () => {
  const previousFlag = process.env.PAPER_SLIPPAGE_ENABLED;
  process.env.PAPER_SLIPPAGE_ENABLED = 'true';
  try {
    const engine = new PaperTradingEngine(() => undefined);
    const player = fakePlayer();
    engine.applyItickQuotes({
      'TRX/USD': {
        pair: 'TRX/USD',
        sourceSymbol: 'TRXUSDT',
        markPrice: 0.333,
        bidPrice: 0.332995,
        askPrice: 0.333005,
        updatedAt: Date.now(),
      },
    });

    const opened = await engine.placeOrder(player, {
      pair: 'TRX/USD',
      side: 'long',
      size: 3_000_000,
      orderType: 'market',
      leverage: 50,
    });
    assert.equal(opened.trade.slippageSource, 'model');
    assert.ok((opened.trade.slippageBps || 0) > 10);
    assert.equal(player.openPositions[0]?.executionModel, 'slippage-v1');

    const closed = await engine.closePosition(player, opened.trade.id);
    assert.equal(closed.trade.slippageSource, 'model');
    assert.ok((closed.trade.slippageBps || 0) > 10);
    assert.ok(closed.trade.pnl < 0);
    assert.equal(player.openPositions.length, 0);
  } finally {
    if (previousFlag === undefined) delete process.env.PAPER_SLIPPAGE_ENABLED;
    else process.env.PAPER_SLIPPAGE_ENABLED = previousFlag;
  }
});
