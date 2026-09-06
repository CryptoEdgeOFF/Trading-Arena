import type { Order, Player, Position } from '../stores/useGameStore';

export const PENDING_MUTATION_TTL_MS = 4000;
const SIZE_EPS = 1e-8;

export type PendingOpen = {
  localId: string;
  kind: 'position' | 'order';
  pair: string;
  side: 'long' | 'short';
  size: number;
  limitPrice: number | null;
  margin: number;
  fee: number;
  knownPositionIds: string[];
  knownOrderIds: string[];
  serverId?: string;
  position?: Position;
  order?: Order;
};

export type PendingMutations = {
  closedPositions: Map<string, number>;
  cancelledOrders: Map<string, number>;
  partialCloses: Map<string, { delta: number; expiresAt: number }>;
  opens: Map<string, PendingOpen>;
};

export function createPendingMutations(): PendingMutations {
  return {
    closedPositions: new Map(),
    cancelledOrders: new Map(),
    partialCloses: new Map(),
    opens: new Map(),
  };
}

export function markPositionPendingClose(state: PendingMutations, positionId: string, now = Date.now()): void {
  state.closedPositions.set(positionId, now + PENDING_MUTATION_TTL_MS);
}

export function markOrderPendingCancel(state: PendingMutations, orderId: string, now = Date.now()): void {
  state.cancelledOrders.set(orderId, now + PENDING_MUTATION_TTL_MS);
}

export function markPositionPendingPartial(state: PendingMutations, positionId: string, delta: number, now = Date.now()): void {
  const existing = state.partialCloses.get(positionId);
  state.partialCloses.set(positionId, {
    delta: (existing?.delta || 0) + delta,
    expiresAt: now + PENDING_MUTATION_TTL_MS,
  });
}

export function confirmPendingOpen(state: PendingMutations, localId: string, serverId?: string): void {
  const pending = state.opens.get(localId);
  if (!pending || !serverId) return;
  pending.serverId = serverId;
  if (pending.position) pending.position = { ...pending.position, id: serverId };
  if (pending.order) pending.order = { ...pending.order, id: serverId };
}

export function dropPendingOpen(state: PendingMutations, localId: string): void {
  state.opens.delete(localId);
}

export function pendingReservedMargin(state: PendingMutations): number {
  let total = 0;
  for (const pending of state.opens.values()) total += pending.margin + pending.fee;
  return total;
}

function sizesMatch(a: number, b: number): boolean {
  return Math.abs(a - b) <= SIZE_EPS || Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b), 1) * 1e-6;
}

function pruneExpiredHides(state: PendingMutations, now: number): void {
  for (const [id, expiresAt] of state.closedPositions) {
    if (expiresAt <= now) state.closedPositions.delete(id);
  }
  for (const [id, expiresAt] of state.cancelledOrders) {
    if (expiresAt <= now) state.cancelledOrders.delete(id);
  }
  for (const [id, info] of state.partialCloses) {
    if (info.expiresAt <= now) state.partialCloses.delete(id);
  }
}

function claimNewRow<T extends { id: string; pair: string; side: string; size: number }>(
  items: T[],
  pending: PendingOpen,
  knownIds: string[],
  claimed: Set<string>,
  extraMatch?: (item: T) => boolean,
): T | undefined {
  return items.find((item) => {
    if (claimed.has(item.id) || knownIds.includes(item.id)) return false;
    if (item.id === pending.localId) return false;
    if (item.pair !== pending.pair || item.side !== pending.side) return false;
    if (!sizesMatch(item.size, pending.size)) return false;
    if (extraMatch && !extraMatch(item)) return false;
    return true;
  });
}

/**
 * Fusionne l'état serveur (WS / /me) avec les clics déjà affichés.
 * Un payload en retard ne peut ni faire réapparaître une clôture, ni doubler
 * un achat, ni effacer une ligne tant que le serveur ne l'a pas confirmée
 * ou refusée.
 */
export function reconcilePlayerWithPending(
  incoming: Player | null,
  state: PendingMutations,
  now = Date.now(),
): Player | null {
  if (!incoming) return incoming;
  pruneExpiredHides(state, now);

  const openPositions = (incoming.openPositions || []).reduce<Position[]>((acc, position) => {
    if (state.closedPositions.has(position.id)) return acc;
    const partial = state.partialCloses.get(position.id);
    if (partial && partial.delta > 0) {
      const newSize = position.size - partial.delta;
      if (newSize <= 0.000_000_1) {
        state.partialCloses.delete(position.id);
        return acc;
      }
      acc.push({ ...position, size: newSize });
      return acc;
    }
    acc.push(position);
    return acc;
  }, []);

  const incomingPositionIds = new Set((incoming.openPositions || []).map((position) => position.id));
  for (const id of Array.from(state.closedPositions.keys())) {
    if (!incomingPositionIds.has(id)) state.closedPositions.delete(id);
  }
  for (const id of Array.from(state.partialCloses.keys())) {
    if (!incomingPositionIds.has(id)) state.partialCloses.delete(id);
  }

  const openOrders = (incoming.openOrders || []).filter((order) => !state.cancelledOrders.has(order.id));
  const incomingOrderIds = new Set((incoming.openOrders || []).map((order) => order.id));
  for (const id of Array.from(state.cancelledOrders.keys())) {
    if (!incomingOrderIds.has(id)) state.cancelledOrders.delete(id);
  }

  const claimedPositions = new Set<string>();
  const claimedOrders = new Set<string>();
  const extraPositions: Position[] = [];
  const extraOrders: Order[] = [];
  let extraMargin = 0;
  let extraFee = 0;

  for (const [localId, pending] of state.opens) {
    if (pending.kind === 'position' && pending.position) {
      if (pending.serverId && incomingPositionIds.has(pending.serverId)) {
        state.opens.delete(localId);
        continue;
      }
      if (incomingPositionIds.has(pending.position.id) || incomingPositionIds.has(localId)) {
        continue;
      }
      const match = claimNewRow(
        incoming.openPositions || [],
        pending,
        pending.knownPositionIds,
        claimedPositions,
      );
      if (match) {
        claimedPositions.add(match.id);
        state.opens.delete(localId);
        continue;
      }
      extraPositions.push(pending.position);
      extraMargin += pending.margin;
      extraFee += pending.fee;
      continue;
    }

    if (pending.kind === 'order' && pending.order) {
      if (pending.serverId && incomingOrderIds.has(pending.serverId)) {
        state.opens.delete(localId);
        continue;
      }
      if (incomingOrderIds.has(pending.order.id) || incomingOrderIds.has(localId)) {
        continue;
      }
      const match = claimNewRow(
        incoming.openOrders || [],
        pending,
        pending.knownOrderIds,
        claimedOrders,
        (order) => pending.limitPrice == null
          || order.limitPrice == null
          || Math.abs((order.limitPrice || 0) - pending.limitPrice) <= Math.max(1, pending.limitPrice) * 1e-8,
      );
      if (match) {
        claimedOrders.add(match.id);
        state.opens.delete(localId);
        continue;
      }
      extraOrders.push(pending.order);
      extraMargin += pending.margin;
      extraFee += pending.fee;
    }
  }

  return {
    ...incoming,
    openPositions: [...openPositions, ...extraPositions],
    openOrders: [...openOrders, ...extraOrders],
    availableMargin: incoming.availableMargin - extraMargin - extraFee,
    usedMargin: incoming.usedMargin + extraMargin,
    feesPaid: incoming.feesPaid + extraFee,
  };
}
