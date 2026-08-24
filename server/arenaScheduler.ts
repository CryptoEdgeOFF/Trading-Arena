/**
 * Scheduler des arènes programmées récurrentes — le « rituel » BTF Arena :
 *
 * Un seul rendez-vous pour l'instant : le WEEKLY CHALLENGE, qui démarre tous
 * les lundis à 08:00 UTC et se termine le vendredi à 21:00 UTC (clôture de la
 * semaine de trading). Le vainqueur devient Champion of the Week. Les Blitz
 * quotidiennes (London/NY/Crypto) sont désactivées pour l'instant.
 *
 * Chaque occurrence est identifiée par une `scheduleKey` (`template:jour`)
 * persistée sur la compétition : la création est idempotente même après
 * redémarrage. Les occurrences de templates retirés sont supprimées tant
 * qu'aucun joueur réel n'y est inscrit. Le scheduler tourne uniquement sur
 * serveur persistant.
 */

import type { CompetitionManager } from './competitionManager.js';

interface ArenaTemplate {
  key: string;
  title: string;
  format: 'blitz' | 'weekly';
  timeZone: string;
  /** Jour de la semaine (0 = dimanche … 6 = samedi), null = tous les jours. */
  weekday: number | null;
  hour: number;
  minute: number;
  durationMs: number;
  /** Création de l'occurrence N heures avant le départ. */
  createAheadMs: number;
  /** false = pas d'email « nouvelle arène » à la création. */
  announceByEmail: boolean;
}

const TEMPLATES: ArenaTemplate[] = [
  {
    key: 'weekly-challenge',
    title: 'WEEKLY CHALLENGE',
    format: 'weekly',
    timeZone: 'UTC',
    weekday: 1,
    hour: 8,
    minute: 0,
    // Lundi 08:00 UTC → vendredi 21:00 UTC (4 j 13 h de trading).
    durationMs: (4 * 24 + 13) * 3_600_000,
    // Fenêtre légèrement > 7 j : dès qu'un challenge démarre, le suivant
    // (exactement 7 j plus tard) est déjà créé et visible.
    createAheadMs: 7 * 24 * 3_600_000 + 3_600_000,
    announceByEmail: true,
  },
];

/** Décalage (ms) entre l'heure locale du fuseau et l'UTC au timestamp donné. */
function tzOffsetMs(timestamp: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(timestamp))) {
    parts[part.type] = part.value;
  }
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - Math.floor(timestamp / 1000) * 1000;
}

/** Champs calendaires (année/mois/jour/jour de semaine) d'un instant dans le fuseau. */
function localDayParts(timestamp: number, timeZone: string): { year: number; month: number; day: number; weekday: number; dayKey: string } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(timestamp))) {
    parts[part.type] = part.value;
  }
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: weekdayIndex,
    dayKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/** Timestamp UTC de `hour:minute` (heure du fuseau) pour le jour calendaire de `dayTimestamp`. */
function zonedTimeForDay(dayTimestamp: number, hour: number, minute: number, timeZone: string): number {
  const { year, month, day } = localDayParts(dayTimestamp, timeZone);
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  // Deux passes pour converger malgré les transitions DST.
  let result = naive - tzOffsetMs(naive, timeZone);
  result = naive - tzOffsetMs(result, timeZone);
  return result;
}

export interface ScheduledArenaInput {
  scheduleKey: string;
  title: string;
  format: 'blitz' | 'weekly';
  startAt: number;
  endAt: number;
  announceByEmail: boolean;
}

/**
 * Occurrences à créer maintenant : pour chaque template, les départs à venir
 * dans la fenêtre `createAheadMs` dont la scheduleKey n'existe pas encore.
 */
export function computeDueOccurrences(now: number, exists: (scheduleKey: string) => boolean): ScheduledArenaInput[] {
  const due: ScheduledArenaInput[] = [];
  for (const template of TEMPLATES) {
    const horizonDays = Math.ceil(template.createAheadMs / 86_400_000) + 1;
    for (let dayOffset = 0; dayOffset <= horizonDays; dayOffset += 1) {
      const dayTimestamp = now + dayOffset * 86_400_000;
      const { weekday, dayKey } = localDayParts(dayTimestamp, template.timeZone);
      if (template.weekday != null && weekday !== template.weekday) continue;
      const startAt = zonedTimeForDay(dayTimestamp, template.hour, template.minute, template.timeZone);
      if (startAt <= now) continue;
      if (startAt - now > template.createAheadMs) continue;
      const scheduleKey = `${template.key}:${dayKey}`;
      if (exists(scheduleKey)) continue;
      due.push({
        scheduleKey,
        title: template.title,
        format: template.format,
        startAt,
        endAt: startAt + template.durationMs,
        announceByEmail: template.announceByEmail,
      });
    }
  }
  return due;
}

/** Drawdown standardisé des arènes ranked programmées (règles identiques pour tous). */
const SCHEDULED_ARENA_DRAWDOWN_PERCENT = 5;

export async function ensureScheduledArenas(manager: CompetitionManager): Promise<number> {
  // Production ne doit pas inventer d'arènes. Activer uniquement en staging
  // avec ENABLE_SCHEDULED_ARENAS=true.
  if (process.env.ENABLE_SCHEDULED_ARENAS !== 'true') return 0;

  let dirty = false;

  // Retire les occurrences des templates désactivés (ex. anciennes Blitz),
  // tant qu'aucun joueur réel n'y est inscrit (les bots de staging
  // 'sim-bot-*' ne comptent pas).
  const activeKeys = new Set(TEMPLATES.map((template) => template.key));
  for (const competition of manager.listAdminCompetitions()) {
    if (!competition.scheduleKey) continue;
    const templateKey = competition.scheduleKey.split(':')[0];
    if (activeKeys.has(templateKey)) continue;
    const onlyBots = competition.entries.every((entry) => entry.userId.startsWith('sim-bot-'));
    if (!onlyBots) continue;
    manager.deleteCompetition(competition.id);
    dirty = true;
    console.log(`[arenaScheduler] Arène programmée obsolète supprimée : ${competition.title} (${competition.scheduleKey})`);
  }

  const due = computeDueOccurrences(Date.now(), (key) => manager.hasCompetitionWithScheduleKey(key));
  for (const occurrence of due) {
    const competition = manager.createCompetition({
      title: occurrence.title,
      code: '',
      executionMode: 'paper',
      startAt: occurrence.startAt,
      endAt: occurrence.endAt,
      dailyDrawdownPercent: SCHEDULED_ARENA_DRAWDOWN_PERCENT,
      isPublic: true,
      format: occurrence.format,
      scheduleKey: occurrence.scheduleKey,
    });
    if (!occurrence.announceByEmail) {
      manager.markCompetitionNotified(competition.id, 'newArena');
    }
    dirty = true;
    console.log(`[arenaScheduler] Arène programmée créée : ${occurrence.title} (${occurrence.scheduleKey}) — départ ${new Date(occurrence.startAt).toISOString()}`);
  }

  if (dirty) await manager.persist();
  return due.length;
}
