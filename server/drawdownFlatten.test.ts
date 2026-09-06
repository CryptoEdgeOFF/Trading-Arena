import assert from 'node:assert/strict';
import test from 'node:test';
import { PaperTradingEngine } from './exchangePaperEngine.js';
import type { Player } from './types.js';

function fakePlayer(): Player {
  return {
    id: 'drawdown-flatten-test',
    name: 'DrawdownFlatten',
    color: '#ffffff',
    avatar: null,
    apiKey: '',
    apiSecret: '',
    traderCode: 'FLAT',
    active: true,
    initialBalance: 10_000,
    currentBalance: 10_000,
    availableMargin: 10_000,
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

test('force flatten closes leftover positions without a live ticker', async () => {
  const engine = new PaperTradingEngine(() => undefined);
  const player = fakePlayer();
  engine.applyItickQuotes({
    'BTC/USD': {
      pair: 'BTC/USD',
      sourceSymbol: 'BTCUSDT',
      markPrice: 80_000,
      bidPrice: 79_996,
      askPrice: 80_004,
      updatedAt: Date.now(),
    },
  });
  await engine.placeOrder(player, {
    pair: 'BTC/USD',
    side: 'long',
    size: 0.1,
    orderType: 'market',
    leverage: 10,
  });
  assert.equal(player.openPositions.length, 1);
  const openedPnl = player.pnl;

  engine.applyItickQuotes({
    'BTC/USD': {
      pair: 'BTC/USD',
      sourceSymbol: 'BTCUSDT',
      markPrice: 70_000,
      bidPrice: 69_996,
      askPrice: 70_004,
      updatedAt: Date.now(),
    },
  });
  engine.recalculateEquity(player);
  assert.ok(player.pnl < openedPnl);

  await engine.forceFlattenPlayer(player, 'drawdown');
  assert.equal(player.openPositions.length, 0);
  assert.equal(player.openOrders.length, 0);
  const frozen = player.pnl;

  engine.applyItickQuotes({
    'BTC/USD': {
      pair: 'BTC/USD',
      sourceSymbol: 'BTCUSDT',
      markPrice: 90_000,
      bidPrice: 89_996,
      askPrice: 90_004,
      updatedAt: Date.now(),
    },
  });
  engine.recalculateEquity(player);
  assert.equal(player.pnl, frozen);
  assert.equal(player.trades.at(-1)?.closeReason, 'drawdown');
});

test('force flatten still works when the market quote disappears', async () => {
  const engine = new PaperTradingEngine(() => undefined);
  const player = fakePlayer();
  player.openPositions.push({
    id: 'zombie',
    pair: 'GOLD/USD',
    side: 'short',
    size: 2,
    entryPrice: 2_400,
    markPrice: 2_410,
    pnl: -20,
    unrealizedFunding: 0,
    leverage: 10,
    margin: 480,
    feesPaid: 0,
    liquidationPrice: 2_640,
    stopLoss: null,
    takeProfit: null,
    openedAt: Date.now(),
  });
  await engine.forceFlattenPlayer(player, 'drawdown');
  assert.equal(player.openPositions.length, 0);
});
