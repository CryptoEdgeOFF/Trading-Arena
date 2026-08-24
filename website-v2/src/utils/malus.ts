/**
 * Malus « roue de la fortune » — purement visuel / annoncé à l'oral.
 * Les durées et le layout de la roue sont partagés entre l'overlay dashboard
 * et le serveur (qui calcule les timestamps). SPIN_MS doit rester synchronisé
 * avec la même constante côté serveur (playerManager).
 */

export type MalusType = 'direction' | 'asset';

export interface EventMalus {
  id: string;
  type: MalusType;
  /** Part de roue (0..5) sur laquelle elle s'arrête. */
  segmentIndex: number;
  /** Début de l'animation de roue. */
  triggeredAt: number;
  /** Fin de la phase de préparation (roue + 1 min). */
  prepEndAt: number;
  /** Fin du malus (prepEndAt + 10 min). */
  endAt: number;
}

/** Durée de l'animation de la roue avant l'arrêt. */
export const MALUS_SPIN_MS = 5_000;
/** Phase de préparation : choix asset/direction + coupe des positions. */
export const MALUS_PREP_MS = 60_000;
/** Durée d'application du malus. */
export const MALUS_ACTIVE_MS = 600_000;

export type MalusPhase = 'spinning' | 'prep' | 'active' | 'ended';

/** Layout de la roue : 6 parts, alternance direction / asset. */
export const MALUS_SEGMENTS: MalusType[] = [
  'direction',
  'asset',
  'direction',
  'asset',
  'direction',
  'asset',
];

export const MALUS_LABELS: Record<MalusType, { title: string; short: string; icon: string; description: string; prep: string; color: string }> = {
  direction: {
    title: 'Direction imposée',
    short: 'Direction',
    icon: '↕',
    description: 'Les adversaires ne peuvent trader que dans UNE seule direction pendant 10 minutes.',
    prep: 'Annoncez la direction (Long ou Short) et coupez les positions non conformes.',
    color: '#ef4444',
  },
  asset: {
    title: 'Asset unique',
    short: 'Asset only',
    icon: '🪙',
    description: 'Les adversaires coupent tout et ne tradent qu\u2019UN seul asset imposé pendant 10 minutes.',
    prep: 'Annoncez l\u2019asset autorisé et faites couper tous les trades en cours.',
    color: '#f59e0b',
  },
};

export function getMalusPhase(malus: EventMalus, now: number): MalusPhase {
  if (now < malus.triggeredAt + MALUS_SPIN_MS) return 'spinning';
  if (now < malus.prepEndAt) return 'prep';
  if (now < malus.endAt) return 'active';
  return 'ended';
}

/**
 * Rotation finale (en degrés) pour que la part `segmentIndex` s'arrête sous le
 * pointeur (en haut). Inclut plusieurs tours complets pour l'effet roue.
 */
export function malusWheelRotation(segmentIndex: number, fullTurns = 6): number {
  const segmentAngle = 360 / MALUS_SEGMENTS.length;
  const center = segmentIndex * segmentAngle + segmentAngle / 2;
  return fullTurns * 360 - center;
}

export function formatMalusClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
