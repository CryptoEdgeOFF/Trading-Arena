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

const histories = new Map<string, PnlSample[]>();
const lastSampleAt = new Map<string, number>();

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
  history.push({ t: now, rows });
  if (history.length > MAX_SAMPLES_PER_COMPETITION) {
    history.splice(0, history.length - MAX_SAMPLES_PER_COMPETITION);
  }
  histories.set(competitionId, history);
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
    }
  }
}
