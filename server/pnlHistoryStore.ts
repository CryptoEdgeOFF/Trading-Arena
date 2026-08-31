/**
 * Course PnL : échantillonne l'équité mark-to-market (réalisé + latent)
 * depuis le départ de l'arène. L'historique est compacté (forme globale +
 * haute résolution récente) et persisté sur l'objet compétition.
 */

export interface PnlSample {
  t: number;
  rows: Array<{ userId: string; pnlPercent: number }>;
}

export interface PnlMoment {
  t: number;
  type: 'leader' | 'top3';
  userId: string;
}

export interface PnlRaceSnapshot {
  samples: PnlSample[];
  moments?: PnlMoment[];
  lastSampleAt?: number;
}

const MAX_SAMPLES_PER_COMPETITION = 720;
const RECENT_FULL_RES_SAMPLES = 180;
const MIN_SAMPLE_INTERVAL_MS = 10_000;
const MAX_TRACKED_ROWS = 40;
const MAX_MOMENTS_PER_COMPETITION = 12;

const histories = new Map<string, PnlSample[]>();
const lastSampleAt = new Map<string, number>();
const moments = new Map<string, PnlMoment[]>();

type PersistHandler = (competitionId: string, snapshot: PnlRaceSnapshot) => void;
let persistHandler: PersistHandler | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const persistDirty = new Set<string>();

export function setPnlHistoryPersistHandler(handler: PersistHandler | null): void {
  persistHandler = handler;
}

function schedulePersist(competitionId: string): void {
  persistDirty.add(competitionId);
  if (persistTimer || !persistHandler) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const handler = persistHandler;
    if (!handler) return;
    for (const id of persistDirty) {
      handler(id, {
        samples: histories.get(id) || [],
        moments: moments.get(id) || [],
        lastSampleAt: lastSampleAt.get(id),
      });
    }
    persistDirty.clear();
  }, 8_000);
}

function detectMoments(competitionId: string, previous: PnlSample | undefined, next: PnlSample): void {
  if (!previous) return;
  const previousIndex = new Map(previous.rows.map((row, index) => [row.userId, index]));
  const detected: PnlMoment[] = [];
  for (let index = 0; index < Math.min(3, next.rows.length); index += 1) {
    const userId = next.rows[index].userId;
    const before = previousIndex.get(userId);
    if (before === undefined || before <= index) continue;
    if (index === 0) detected.push({ t: next.t, type: 'leader', userId });
    else if (before > 2) detected.push({ t: next.t, type: 'top3', userId });
  }
  if (!detected.length) return;
  const list = moments.get(competitionId) || [];
  list.push(...detected);
  if (list.length > MAX_MOMENTS_PER_COMPETITION) {
    list.splice(0, list.length - MAX_MOMENTS_PER_COMPETITION);
  }
  moments.set(competitionId, list);
}

function rankedRows(
  leaderboard: Array<{ userId: string; rank: number; pnlPercent: number }>,
): Array<{ userId: string; pnlPercent: number }> {
  return leaderboard
    .filter((row) => row.rank > 0)
    .slice(0, MAX_TRACKED_ROWS)
    .map((row) => ({ userId: row.userId, pnlPercent: Number(row.pnlPercent) || 0 }));
}

/** Conserve le premier point, compacte le milieu, garde la fin en haute résolution. */
export function compactPnlSamples(samples: PnlSample[], maxSamples = MAX_SAMPLES_PER_COMPETITION): PnlSample[] {
  if (samples.length <= maxSamples) return samples;
  const keepRecent = Math.min(RECENT_FULL_RES_SAMPLES, Math.floor(maxSamples / 3));
  const recent = samples.slice(-keepRecent);
  const older = samples.slice(0, -keepRecent);
  const budget = Math.max(2, maxSamples - keepRecent);
  const step = Math.ceil(older.length / budget);
  const compacted = older.filter((_, index) => index === 0 || index % step === 0);
  return [...compacted, ...recent];
}

function carryForwardRows(
  previous: Array<{ userId: string; pnlPercent: number }> | undefined,
  current: Array<{ userId: string; pnlPercent: number }>,
): Array<{ userId: string; pnlPercent: number }> {
  if (!previous?.length) return current;
  const byId = new Map(previous.map((row) => [row.userId, row.pnlPercent]));
  for (const row of current) byId.set(row.userId, row.pnlPercent);
  return [...byId.entries()]
    .map(([userId, pnlPercent]) => ({ userId, pnlPercent }))
    .sort((a, b) => b.pnlPercent - a.pnlPercent)
    .slice(0, MAX_TRACKED_ROWS);
}

export function hydratePnlHistory(competitionId: string, snapshot: PnlRaceSnapshot | null | undefined): void {
  if (!competitionId || !snapshot?.samples?.length) return;
  if ((histories.get(competitionId) || []).length >= snapshot.samples.length) return;
  histories.set(competitionId, compactPnlSamples(snapshot.samples));
  if (snapshot.moments?.length) moments.set(competitionId, snapshot.moments.slice(-MAX_MOMENTS_PER_COMPETITION));
  if (snapshot.lastSampleAt) lastSampleAt.set(competitionId, snapshot.lastSampleAt);
  else lastSampleAt.set(competitionId, snapshot.samples[snapshot.samples.length - 1]?.t || 0);
}

export function maybeRecordPnlSample(
  competitionId: string,
  leaderboard: Array<{ userId: string; rank: number; pnlPercent: number }>,
  options?: { startAt?: number; now?: number },
): void {
  const now = options?.now ?? Date.now();
  const last = lastSampleAt.get(competitionId) || 0;
  if (now - last < MIN_SAMPLE_INTERVAL_MS) return;

  const current = rankedRows(leaderboard);
  if (!current.length) return;

  let history = histories.get(competitionId) || [];
  const startAt = options?.startAt;
  if (history.length === 0 && startAt && startAt < now) {
    history = [{
      t: startAt,
      rows: current.map((row) => ({ userId: row.userId, pnlPercent: 0 })),
    }];
  }

  const rows = carryForwardRows(history[history.length - 1]?.rows, current);
  const sample: PnlSample = { t: now, rows };
  detectMoments(competitionId, history[history.length - 1], sample);
  history.push(sample);
  history = compactPnlSamples(history);
  histories.set(competitionId, history);
  lastSampleAt.set(competitionId, now);
  schedulePersist(competitionId);
}

export function getPnlMoments(competitionId: string): PnlMoment[] {
  return moments.get(competitionId) || [];
}

export function getPnlHistory(competitionId: string): PnlSample[] {
  return histories.get(competitionId) || [];
}

const PUBLIC_PNL_MAX_SAMPLES = 160;
const PUBLIC_PNL_MAX_TRADERS = 12;

/** Payload public compact : le graphe client ne garde que ~96 points. */
export function slimPublicPnlHistory(
  samples: PnlSample[],
  leaderboard: Array<{ userId: string; rank: number }>,
): PnlSample[] {
  const keep = new Set(
    leaderboard.filter((row) => row.rank > 0).slice(0, PUBLIC_PNL_MAX_TRADERS).map((row) => row.userId),
  );
  if (!samples.length || keep.size === 0) return [];
  const step = samples.length <= PUBLIC_PNL_MAX_SAMPLES
    ? 1
    : Math.ceil(samples.length / PUBLIC_PNL_MAX_SAMPLES);
  return samples
    .filter((_, index) => index === 0 || index === samples.length - 1 || index % step === 0)
    .map((sample) => ({
      t: sample.t,
      rows: sample.rows.filter((row) => keep.has(row.userId)),
    }));
}

export function getPnlHistoryWithLivePoint(
  competitionId: string,
  leaderboard: Array<{ userId: string; rank: number; pnlPercent: number }>,
): PnlSample[] {
  const stored = histories.get(competitionId) || [];
  const now = Date.now();
  const last = stored[stored.length - 1];
  if (last && now - last.t < 2_000) return stored;
  const current = rankedRows(leaderboard);
  if (!current.length) return stored;
  return [...stored, { t: now, rows: carryForwardRows(last?.rows, current) }];
}

export function prunePnlHistories(activeCompetitionIds: Set<string>): void {
  for (const competitionId of histories.keys()) {
    if (activeCompetitionIds.has(competitionId)) continue;
    histories.delete(competitionId);
    lastSampleAt.delete(competitionId);
    moments.delete(competitionId);
  }
}

export function hasPnlHistory(competitionId: string): boolean {
  return (histories.get(competitionId) || []).length >= 2;
}

export function reconstructPnlHistoryFromTrades(
  competitionId: string,
  startAt: number,
  endAt: number,
  startingBalance: number,
  traders: Array<{
    userId: string;
    trades: Array<{ time: number; action: string; pnl: number }>;
    openPositions?: Array<{ openedAt: number; pnl: number }>;
    finalPnlPercent: number;
  }>,
  now = Date.now(),
): PnlSample[] {
  if (hasPnlHistory(competitionId)) return getPnlHistory(competitionId);
  const balance = startingBalance > 0 ? startingBalance : 10_000;
  const series = traders.map((trader) => ({
    userId: trader.userId,
    closes: trader.trades
      .filter((trade) => trade.action === 'close' && Number.isFinite(trade.time) && trade.time > 0)
      .sort((a, b) => a.time - b.time)
      .map((trade) => ({ t: trade.time, pnl: Number(trade.pnl) || 0 })),
    opens: (trader.openPositions || [])
      .filter((position) => Number.isFinite(position.openedAt) && (position.openedAt || 0) > 0)
      .map((position) => ({ openedAt: position.openedAt, pnl: Number(position.pnl) || 0 })),
    finalPnlPercent: Number(trader.finalPnlPercent) || 0,
  }));
  if (!series.length) return [];

  const origin = Math.max(0, startAt);
  const times = new Set<number>([origin]);
  for (const trader of series) {
    for (const event of trader.closes) times.add(event.t);
    for (const position of trader.opens) times.add(position.openedAt);
  }
  const finishAt = endAt > startAt ? endAt : Math.max(
    ...series.flatMap((trader) => [
      ...trader.closes.map((event) => event.t),
      ...trader.opens.map((position) => position.openedAt),
    ]),
    now,
  );
  times.add(Math.min(finishAt, now));
  if (finishAt > now && endAt > startAt && endAt <= now) times.add(finishAt);
  const sorted = [...times].filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  if (sorted.length === 0) return [];

  const maxSamples = Math.min(MAX_SAMPLES_PER_COMPETITION, 240);
  const picked = sorted.length <= maxSamples
    ? sorted
    : sorted.filter((_, index) => index === 0 || index === sorted.length - 1 || index % Math.ceil(sorted.length / (maxSamples - 2)) === 0);

  const samples: PnlSample[] = picked.map((t) => ({
    t,
    rows: series.map((trader) => {
      if (endAt > startAt && t >= endAt) {
        return { userId: trader.userId, pnlPercent: trader.finalPnlPercent };
      }
      const realized = trader.closes
        .filter((event) => event.t <= t)
        .reduce((sum, event) => sum + event.pnl, 0);
      const latent = trader.opens.reduce((sum, position) => {
        if (t < position.openedAt) return sum;
        const span = Math.max(1, now - position.openedAt);
        const progress = Math.min(1, (t - position.openedAt) / span);
        return sum + position.pnl * progress;
      }, 0);
      return { userId: trader.userId, pnlPercent: ((realized + latent) / balance) * 100 };
    }),
  }));

  if (samples.length < 2) {
    const first = samples[0] || {
      t: origin || now - 60_000,
      rows: series.map((trader) => ({ userId: trader.userId, pnlPercent: 0 })),
    };
    samples.splice(0, samples.length, first, {
      t: Math.min(finishAt, now),
      rows: series.map((trader) => ({ userId: trader.userId, pnlPercent: trader.finalPnlPercent })),
    });
  }

  const compacted = compactPnlSamples(samples);
  histories.set(competitionId, compacted);
  lastSampleAt.set(competitionId, compacted[compacted.length - 1]?.t || now);
  for (let index = 1; index < compacted.length; index += 1) {
    detectMoments(competitionId, compacted[index - 1], compacted[index]);
  }
  schedulePersist(competitionId);
  return compacted;
}

export function resetPnlHistoryStoreForTests(): void {
  histories.clear();
  lastSampleAt.clear();
  moments.clear();
  persistDirty.clear();
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}
