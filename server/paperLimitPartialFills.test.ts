import assert from 'node:assert/strict';
import test from 'node:test';
import { PaperTradingEngine } from './exchangePaperEngine.js';
import type { PaperOrderBook } from './paperSlippage.js';
import type { Player } from './types.js';

function fakePlayer(id: string): Player {
  return {
    id,
    name: id,
    color: '#fff',
    avatar: null,
    apiKey: '',
    apiSecret: '',
    traderCode: id,
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

function quote(engine: PaperTradingEngine, markPrice = 100): void {
  engine.applyItickQuotes({
    'TRX/USD': {
      pair: 'TRX/USD',
      sourceSymbol: 'TRXUSDT',
      markPrice,
      bidPrice: markPrice - 0.01,
      askPrice: markPrice + 0.01,
      updatedAt: Date.now(),
    },
  });
}

function enableFlags(): () => void {
  const slippage = process.env.PAPER_SLIPPAGE_ENABLED;
  const partials = process.env.PAPER_LIMIT_PARTIAL_FILLS;
  process.env.PAPER_SLIPPAGE_ENABLED = 'true';
  process.env.PAPER_LIMIT_PARTIAL_FILLS = 'true';
  return () => {
    if (slippage === undefined) delete process.env.PAPER_SLIPPAGE_ENABLED;
    else process.env.PAPER_SLIPPAGE_ENABLED = slippage;
    if (partials === undefined) delete process.env.PAPER_LIMIT_PARTIAL_FILLS;
    else process.env.PAPER_LIMIT_PARTIAL_FILLS = partials;
  };
}

test('partial limit fills reserve only the remainder, do not replay snapshots, and merge VWAP', async () => {
  const restore = enableFlags();
  let book: PaperOrderBook | undefined;
  try {
    const player = fakePlayer('partial-vwap');
    const players = new Map([[player.id, player]]);
    const engine = new PaperTradingEngine(() => undefined, undefined, () => book);
    engine.setPlayerResolver((id) => players.get(id));
    engine.trackPlayers([player]);
    (engine as unknown as { bootedAt: number }).bootedAt = 0;
    quote(engine, 100.001);

    await engine.placeOrder(player, {
      pair: 'TRX/USD',
      side: 'long',
      size: 10,
      orderType: 'limit',
      limitPrice: 100,
      leverage: 10,
    });
    engine.trackPlayers([player]);
    const order = player.openOrders[0]!;
    const initialMarginReserve = order.marginReserved;
    const initialFeeReserve = order.feeEstimate;

    const firstTs = Date.now();
    book = {
      asks: [{ price: 99, volume: 4 }, { price: 101, volume: 100 }],
      bids: [],
      ts: firstTs,
    };
    quote(engine, 100.002);

    assert.equal(order.filledSize, 4);
    assert.equal(order.averageFillPrice, 99);
    assert.equal(order.lastDepthTs, firstTs);
    assert.ok(Math.abs(order.marginReserved - initialMarginReserve * 0.6) < 1e-9);
    assert.ok(Math.abs(order.feeEstimate - initialFeeReserve * 0.6) < 1e-9);
    assert.equal(player.openPositions[0]?.size, 4);
    assert.equal(player.tradeCount, 1);
    assert.equal(player.trades.length, 1);
    assert.ok((player.trades[0]?.slippageBps ?? 0) < 0);
    assert.deepEqual(player.trades[0]?.fillDetails, [{ price: 99, size: 4, source: 'book' }]);

    quote(engine, 100.003);
    assert.equal(order.filledSize, 4, 'the same depth snapshot must not fill twice');
    assert.equal(player.trades.length, 1);

    book = {
      asks: [{ price: 100, volume: 6 }],
      bids: [],
      ts: firstTs + 1,
    };
    quote(engine, 100.004);

    assert.equal(player.openOrders.length, 0);
    assert.equal(player.openPositions.length, 1);
    assert.equal(player.openPositions[0]?.size, 10);
    assert.ok(Math.abs((player.openPositions[0]?.entryPrice ?? 0) - 99.6) < 1e-9);
    assert.equal(player.tradeCount, 1);
    assert.equal(player.trades.length, 2);
    assert.equal(player.trades[1]?.orderId, order.id);
    assert.equal(player.trades[1]?.fillIndex, 2);
  } finally {
    restore();
  }
});

test('partial slippage-v1 limits wait when depth is absent or stale', async () => {
  const restore = enableFlags();
  let book: PaperOrderBook | undefined;
  try {
    const player = fakePlayer('partial-stale');
    const engine = new PaperTradingEngine(() => undefined, undefined, () => book);
    engine.setPlayerResolver((id) => id === player.id ? player : undefined);
    engine.trackPlayers([player]);
    (engine as unknown as { bootedAt: number }).bootedAt = 0;
    quote(engine);
    await engine.placeOrder(player, {
      pair: 'TRX/USD',
      side: 'short',
      size: 5,
      orderType: 'limit',
      limitPrice: 100,
      leverage: 10,
    });
    engine.trackPlayers([player]);

    quote(engine);
    assert.equal(player.openOrders[0]?.filledSize, 0);

    book = {
      asks: [],
      bids: [{ price: 101, volume: 5 }],
      ts: Date.now() - 10_000,
    };
    quote(engine);
    assert.equal(player.openOrders[0]?.filledSize, 0);
    assert.equal(player.openPositions.length, 0);
  } finally {
    restore();
  }
});

test('competing limits consume visible liquidity in price-time order', async () => {
  const restore = enableFlags();
  let book: PaperOrderBook | undefined;
  try {
    const first = fakePlayer('price-time-first');
    const second = fakePlayer('price-time-second');
    const betterPrice = fakePlayer('price-time-better-price');
    const players = new Map([
      [first.id, first],
      [second.id, second],
      [betterPrice.id, betterPrice],
    ]);
    const engine = new PaperTradingEngine(() => undefined, undefined, () => book);
    engine.setPlayerResolver((id) => players.get(id));
    engine.trackPlayers([first, second, betterPrice]);
    (engine as unknown as { bootedAt: number }).bootedAt = 0;
    quote(engine);

    for (const player of [first, second]) {
      await engine.placeOrder(player, {
        pair: 'TRX/USD',
        side: 'long',
        size: 5,
        orderType: 'limit',
        limitPrice: 100,
        leverage: 10,
      });
    }
    await engine.placeOrder(betterPrice, {
      pair: 'TRX/USD',
      side: 'long',
      size: 5,
      orderType: 'limit',
      limitPrice: 101,
      leverage: 10,
    });
    first.openOrders[0]!.createdAt = 1;
    second.openOrders[0]!.createdAt = 2;
    betterPrice.openOrders[0]!.createdAt = 3;
    engine.trackPlayers([first, second, betterPrice]);

    book = {
      asks: [{ price: 100, volume: 10 }],
      bids: [],
      ts: Date.now(),
    };
    quote(engine);

    assert.equal(betterPrice.openPositions[0]?.size, 5, 'better price has priority over earlier time');
    assert.equal(first.openPositions[0]?.size, 5);
    assert.equal(first.openOrders.length, 0);
    assert.equal(second.openPositions.length, 0);
    assert.equal(second.openOrders[0]?.filledSize, 0);
    quote(engine, 100.006);
    assert.equal(second.openPositions.length, 0, 'depleted liquidity cannot replay on the next tick');
    assert.equal(second.openOrders[0]?.filledSize, 0);
  } finally {
    restore();
  }
});

test('persisted partial orders resume into the same position after restart', () => {
  const restore = enableFlags();
  const depthTs = Date.now();
  const book: PaperOrderBook = {
    asks: [{ price: 100, volume: 6 }],
    bids: [],
    ts: depthTs,
  };
  try {
    const player = fakePlayer('partial-restart');
    player.tradeCount = 1;
    player.openOrders.push({
      id: 'persisted-order',
      pair: 'TRX/USD',
      side: 'long',
      size: 10,
      orderType: 'limit',
      status: 'open',
      limitPrice: 100,
      leverage: 10,
      marginReserved: 60,
      feeEstimate: 0.02,
      createdAt: depthTs - 5_000,
      updatedAt: depthTs - 4_000,
      executionModel: 'slippage-v1',
      filledSize: 4,
      averageFillPrice: 99,
      lastDepthTs: depthTs - 1,
    });
    player.openPositions.push({
      id: 'persisted-order',
      pair: 'TRX/USD',
      side: 'long',
      size: 4,
      entryPrice: 99,
      markPrice: 99,
      pnl: 0,
      unrealizedFunding: 0,
      leverage: 10,
      margin: 39.6,
      feesPaid: 0.01,
      liquidationPrice: 89.1,
      stopLoss: null,
      takeProfit: null,
      openedAt: depthTs - 5_000,
      executionModel: 'slippage-v1',
    });
    player.trades.push({
      id: 'persisted-order-fill-1',
      orderId: 'persisted-order',
      fillIndex: 1,
      playerName: player.name,
      playerColor: player.color,
      pair: 'TRX/USD',
      side: 'long',
      size: 4,
      price: 99,
      fee: 0.01,
      leverage: 10,
      orderType: 'limit',
      pnl: 0,
      time: depthTs - 4_000,
      action: 'open',
      requestedPrice: 100,
      slippageSource: 'itick-l5',
      fillDetails: [{ price: 99, size: 4, source: 'book' }],
    });

    const engine = new PaperTradingEngine(() => undefined, undefined, () => book);
    engine.setPlayerResolver((id) => id === player.id ? player : undefined);
    engine.trackPlayers([player]);
    (engine as unknown as { bootedAt: number }).bootedAt = 0;
    quote(engine, 100.005);

    assert.equal(player.openOrders.length, 0);
    assert.equal(player.openPositions.length, 1);
    assert.equal(player.openPositions[0]?.size, 10);
    assert.ok(Math.abs((player.openPositions[0]?.entryPrice ?? 0) - 99.6) < 1e-9);
    assert.equal(player.tradeCount, 1);
    assert.equal(player.trades.at(-1)?.fillIndex, 2);
  } finally {
    restore();
  }
});

test('flag off preserves the existing full-fill limit behavior', async () => {
  const previousSlippage = process.env.PAPER_SLIPPAGE_ENABLED;
  const previousPartials = process.env.PAPER_LIMIT_PARTIAL_FILLS;
  process.env.PAPER_SLIPPAGE_ENABLED = 'true';
  delete process.env.PAPER_LIMIT_PARTIAL_FILLS;
  try {
    const player = fakePlayer('legacy-limit');
    const engine = new PaperTradingEngine(() => undefined);
    engine.setPlayerResolver((id) => id === player.id ? player : undefined);
    engine.trackPlayers([player]);
    (engine as unknown as { bootedAt: number }).bootedAt = 0;
    quote(engine, 100);
    await engine.placeOrder(player, {
      pair: 'TRX/USD',
      side: 'long',
      size: 5,
      orderType: 'limit',
      limitPrice: 99,
      leverage: 10,
    });
    engine.trackPlayers([player]);
    quote(engine, 99);

    assert.equal(player.openOrders.length, 0);
    assert.equal(player.openPositions[0]?.size, 5);
    assert.equal(player.openPositions[0]?.entryPrice, 99);
    assert.equal(player.tradeCount, 1);
  } finally {
    if (previousSlippage === undefined) delete process.env.PAPER_SLIPPAGE_ENABLED;
    else process.env.PAPER_SLIPPAGE_ENABLED = previousSlippage;
    if (previousPartials === undefined) delete process.env.PAPER_LIMIT_PARTIAL_FILLS;
    else process.env.PAPER_LIMIT_PARTIAL_FILLS = previousPartials;
  }
});
