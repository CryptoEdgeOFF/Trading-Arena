/**
 * Historique PnL des arènes live, pour le mode spectateur mobile : on
 * échantillonne régulièrement le PnL % des meilleurs participants et on sert
 * la série au client qui trace les courbes (course au PnL).
 *
 * Stockage mémoire uniquement : c'est un flux d'ambiance temps réel, pas une
 * donnée comptable. Un redéploiement repart d'un historique vide. Fenêtre
 * glissante bornée pour un coût mémoire constant par arène.
 */

export interface PnlSample {
  t: number;
  rows: Array<{ userId: string; pnlPercent: number }>;
}

const MAX_SAMPLES_PER_COMPETITION = 480;
const MIN_SAMPLE_INTERVAL_MS = 15_000;
const MAX_TRACKED_ROWS = 10;

export interface PnlMoment {
  t: number;
  /** 'leader' = nouveau #1, 'top3' = entrée dans le top 3. */
  type: 'leader' | 'top3';
  userId: string;
}

const MAX_MOMENTS_PER_COMPETITION = 12;

const histories = new Map<string, PnlSample[]>();
const lastSampleAt = new Map<string, number>();
const moments = new Map<string, PnlMoment[]>();

/**
 * Détecte les « moments live » entre deux échantillons : changement de
 * leader et entrées dans le top 3. Les rows sont déjà en ordre de classement.
 */
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

/**
 * Enregistre un échantillon si le précédent date d'au moins 20 s.
 * `leaderboard` doit être trié/rangé (sortAndRankLeaderboard) : on ne garde
 * que les participants classés (rank > 0), top 10.
 */
export function maybeRecordPnlSample(
  competitionId: string,
  leaderboard: Array<{ userId: string; rank: number; pnlPercent: number }>,
): void {
  const now = Date.now();
  const last = lastSampleAt.get(competitionId) || 0;
  if (now - last < MIN_SAMPLE_INTERVAL_MS) return;
  const rows = leaderboard
    .filter((row) => row.rank > 0)
    .slice(0, MAX_TRACKED_ROWS)
    .map((row) => ({ userId: row.userId, pnlPercent: Number(row.pnlPercent) || 0 }));
  if (!rows.length) return;
  lastSampleAt.set(competitionId, now);
  const history = histories.get(competitionId) || [];
  const sample: PnlSample = { t: now, rows };
  detectMoments(competitionId, history[history.length - 1], sample);
  history.push(sample);
  if (history.length > MAX_SAMPLES_PER_COMPETITION) {
    history.splice(0, history.length - MAX_SAMPLES_PER_COMPETITION);
  }
  histories.set(competitionId, history);
}

export function getPnlMoments(competitionId: string): PnlMoment[] {
  return moments.get(competitionId) || [];
}

export function getPnlHistory(competitionId: string): PnlSample[] {
  return histories.get(competitionId) || [];
}

/**
 * Renvoie l'historique stocké + un point éphémère « maintenant » construit
 * depuis le leaderboard courant (non persisté). Le client dispose ainsi
 * toujours du dernier PnL en bout de courbe, sans attendre le prochain
 * échantillon throttlé — c'est ce qui rend la courbe visible immédiatement.
 */
export function getPnlHistoryWithLivePoint(
  competitionId: string,
  leaderboard: Array<{ userId: string; rank: number; pnlPercent: number }>,
): PnlSample[] {
  const stored = histories.get(competitionId) || [];
  const now = Date.now();
  const last = stored[stored.length - 1];
  if (last && now - last.t < 2_000) return stored;
  const rows = leaderboard
    .filter((row) => row.rank > 0)
    .slice(0, MAX_TRACKED_ROWS)
    .map((row) => ({ userId: row.userId, pnlPercent: Number(row.pnlPercent) || 0 }));
  if (!rows.length) return stored;
  return [...stored, { t: now, rows }];
}

/** Libère les arènes qui n'ont plus rien à montrer (appelé opportunément). */
export function prunePnlHistories(activeCompetitionIds: Set<string>): void {
  for (const competitionId of histories.keys()) {
    if (!activeCompetitionIds.has(competitionId)) {
      histories.delete(competitionId);
      lastSampleAt.delete(competitionId);
      moments.delete(competitionId);
    }
  }
}
