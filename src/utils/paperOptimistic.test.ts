import assert from 'node:assert/strict';
import test from 'node:test';
import type { Order, Player, Position } from '../stores/useGameStore';
import {
  confirmPendingOpen,
  createPendingMutations,
  dropPendingOpen,
  markPositionPendingClose,
  pendingReservedMargin,
  reconcilePlayerWithPending,
} from './paperOptimistic';

function position(partial: Partial<Position> & Pick<Position, 'id' | 'pair' | 'side' | 'size'>): Position {
  return {
    entryPrice: 100,
    markPrice: 100,
    pnl: 0,
    unrealizedFunding: 0,
    leverage: 5,
    margin: 20,
    feesPaid: 0.1,
    liquidationPrice: 80,
    stopLoss: null,
    takeProfit: null,
    ...partial,
  };
}

function order(partial: Partial<Order> & Pick<Order, 'id' | 'pair' | 'side' | 'size'>): Order {
  return {
    orderType: 'limit',
    status: 'open',
    limitPrice: 99,
    leverage: 5,
    marginReserved: 20,
    feeEstimate: 0.1,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

function player(partial: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    name: 'Trader',
    color: '#fff',
    avatar: null,
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
    rank: 1,
    previousRank: 1,
    badges: [],
    winStreak: 0,
    longestPositionMinutes: 0,
    biggestTradePnl: 0,
    bestTradePercent: 0,
    lastUpdate: 0,
    connected: true,
    ...partial,
  };
}

test('close tombstone hides a stale WS payload then releases once the server dropped it', () => {
  const state = createPendingMutations();
  const existing = position({ id: 'pos-1', pair: 'BTC/USD', side: 'long', size: 0.001 });
  markPositionPendingClose(state, 'pos-1');

  const stale = reconcilePlayerWithPending(player({ openPositions: [existing] }), state);
  assert.equal(stale?.openPositions.length, 0);

  const confirmed = reconcilePlayerWithPending(player({ openPositions: [] }), state);
  assert.equal(confirmed?.openPositions.length, 0);
  assert.equal(state.closedPositions.size, 0);
});

test('optimistic market buy stays visible on a stale payload and never duplicates when the server row arrives', () => {
  const state = createPendingMutations();
  const known = position({ id: 'pos-old', pair: 'BTC/USD', side: 'long', size: 0.002 });
  const local = position({ id: 'opt-1', pair: 'BTC/USD', side: 'long', size: 0.001, margin: 20, feesPaid: 0.1 });
  state.opens.set('opt-1', {
    localId: 'opt-1',
    kind: 'position',
    pair: 'BTC/USD',
    side: 'long',
    size: 0.001,
    limitPrice: null,
    margin: 20,
    fee: 0.1,
    knownPositionIds: [known.id],
    knownOrderIds: [],
    position: local,
  });

  const stale = reconcilePlayerWithPending(player({
    availableMargin: 10_000,
    usedMargin: 40,
    openPositions: [known],
  }), state);
  assert.deepEqual(stale?.openPositions.map((item) => item.id), ['pos-old', 'opt-1']);
  assert.equal(stale?.availableMargin, 9979.9);
  assert.equal(state.opens.size, 1);

  const again = reconcilePlayerWithPending(stale, state);
  assert.deepEqual(again?.openPositions.map((item) => item.id), ['pos-old', 'opt-1']);

  const live = reconcilePlayerWithPending(player({
    availableMargin: 9979.9,
    usedMargin: 60,
    openPositions: [
      known,
      position({ id: 'pos-server', pair: 'BTC/USD', side: 'long', size: 0.001 }),
    ],
  }), state);
  assert.deepEqual(live?.openPositions.map((item) => item.id), ['pos-old', 'pos-server']);
  assert.equal(state.opens.size, 0);
});

test('two identical buys each claim a different server row', () => {
  const state = createPendingMutations();
  for (const localId of ['opt-a', 'opt-b']) {
    state.opens.set(localId, {
      localId,
      kind: 'position',
      pair: 'BTC/USD',
      side: 'long',
      size: 0.001,
      limitPrice: null,
      margin: 20,
      fee: 0.1,
      knownPositionIds: [],
      knownOrderIds: [],
      position: position({ id: localId, pair: 'BTC/USD', side: 'long', size: 0.001 }),
    });
  }

  const live = reconcilePlayerWithPending(player({
    openPositions: [
      position({ id: 'srv-1', pair: 'BTC/USD', side: 'long', size: 0.001 }),
      position({ id: 'srv-2', pair: 'BTC/USD', side: 'long', size: 0.001 }),
    ],
  }), state);
  assert.deepEqual(live?.openPositions.map((item) => item.id).sort(), ['srv-1', 'srv-2']);
  assert.equal(state.opens.size, 0);
});

test('HTTP confirm then server payload replaces the local id without a second row', () => {
  const state = createPendingMutations();
  state.opens.set('opt-1', {
    localId: 'opt-1',
    kind: 'position',
    pair: 'ETH/USD',
    side: 'short',
    size: 0.5,
    limitPrice: null,
    margin: 100,
    fee: 1,
    knownPositionIds: [],
    knownOrderIds: [],
    position: position({ id: 'opt-1', pair: 'ETH/USD', side: 'short', size: 0.5 }),
  });
  confirmPendingOpen(state, 'opt-1', { id: 'srv-eth', price: 2400 });
  const afterHttp = reconcilePlayerWithPending(player({ openPositions: [] }), state);
  assert.deepEqual(afterHttp?.openPositions.map((item) => item.id), ['srv-eth']);
  assert.equal(afterHttp?.openPositions[0]?.entryPrice, 2400);

  const afterWs = reconcilePlayerWithPending(player({
    openPositions: [position({ id: 'srv-eth', pair: 'ETH/USD', side: 'short', size: 0.5 })],
  }), state);
  assert.deepEqual(afterWs?.openPositions.map((item) => item.id), ['srv-eth']);
  assert.equal(state.opens.size, 0);
});

test('rejected open disappears immediately', () => {
  const state = createPendingMutations();
  state.opens.set('opt-1', {
    localId: 'opt-1',
    kind: 'position',
    pair: 'BTC/USD',
    side: 'long',
    size: 0.001,
    limitPrice: null,
    margin: 20,
    fee: 0.1,
    knownPositionIds: [],
    knownOrderIds: [],
    position: position({ id: 'opt-1', pair: 'BTC/USD', side: 'long', size: 0.001 }),
  });
  dropPendingOpen(state, 'opt-1');
  const live = reconcilePlayerWithPending(player({ openPositions: [] }), state);
  assert.equal(live?.openPositions.length, 0);
  assert.equal(pendingReservedMargin(state), 0);
});

test('optimistic limit order stays until the server order id appears', () => {
  const state = createPendingMutations();
  state.opens.set('opt-l', {
    localId: 'opt-l',
    kind: 'order',
    pair: 'BTC/USD',
    side: 'long',
    size: 0.01,
    limitPrice: 99,
    margin: 20,
    fee: 0.1,
    knownPositionIds: [],
    knownOrderIds: [],
    order: order({ id: 'opt-l', pair: 'BTC/USD', side: 'long', size: 0.01 }),
  });

  const stale = reconcilePlayerWithPending(player({ openOrders: [] }), state);
  assert.deepEqual(stale?.openOrders.map((item) => item.id), ['opt-l']);

  const live = reconcilePlayerWithPending(player({
    openOrders: [order({ id: 'ord-srv', pair: 'BTC/USD', side: 'long', size: 0.01 })],
  }), state);
  assert.deepEqual(live?.openOrders.map((item) => item.id), ['ord-srv']);
  assert.equal(state.opens.size, 0);
});
