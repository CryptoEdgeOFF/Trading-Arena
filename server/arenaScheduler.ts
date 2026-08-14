/**
 * Scheduler des arènes programmées récurrentes — le « rituel » BTF Arena :
 *
 * - Blitz quotidiennes de 30 min calées sur les sessions de marché
 *   (London Open, NY Open, Crypto Night), heure de Paris.
 * - FRIDAY NIGHT ARENA hebdomadaire : 1 h, tout le monde part en même temps,
 *   le vainqueur devient Champion of the Week.
 *
 * Chaque occurrence est identifiée par une `scheduleKey` (`template:jour`)
 * persistée sur la compétition : la création est idempotente même après
 * redémarrage. Le scheduler tourne uniquement sur serveur persistant.
 */

import type { CompetitionManager } from './competitionManager.js';

const SCHEDULE_TIMEZONE = 'Europe/Paris';

interface ArenaTemplate {
  key: string;
  title: string;
  format: 'blitz' | 'weekly';
  /** Jour de la semaine (0 = dimanche … 6 = samedi), null = tous les jours. */
  weekday: number | null;
  hour: number;
  minute: number;
  durationMs: number;
  /** Création de l'occurrence N heures avant le départ. */
  createAheadMs: number;
  /** Blitz : pas d'email « nouvelle arène » (3/jour = spam). */
  announceByEmail: boolean;
}

const TEMPLATES: ArenaTemplate[] = [
  {
    key: 'blitz-london',
    title: 'LONDON OPEN BLITZ',
    format: 'blitz',
    weekday: null,
    hour: 9,
    minute: 0,
    durationMs: 30 * 60_000,
    createAheadMs: 26 * 3_600_000,
    announceByEmail: false,
  },
  {
    key: 'blitz-ny',
    title: 'NY OPEN BLITZ',
    format: 'blitz',
    weekday: null,
    hour: 15,
    minute: 30,
    durationMs: 30 * 60_000,
    createAheadMs: 26 * 3_600_000,
    announceByEmail: false,
  },
  {
    key: 'blitz-crypto',
    title: 'CRYPTO NIGHT BLITZ',
    format: 'blitz',
    weekday: null,
    hour: 22,
    minute: 0,
    durationMs: 30 * 60_000,
    createAheadMs: 26 * 3_600_000,
    announceByEmail: false,
  },
  {
    key: 'friday-night',
    title: 'FRIDAY NIGHT ARENA',
    format: 'weekly',
    weekday: 5,
    hour: 21,
    minute: 0,
    durationMs: 60 * 60_000,
    createAheadMs: 7 * 24 * 3_600_000,
    announceByEmail: true,
  },
];

/** Décalage (ms) entre l'heure locale du fuseau et l'UTC au timestamp donné. */
function tzOffsetMs(timestamp: number): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: SCHEDULE_TIMEZONE,
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

/** Champs calendaire (année/mois/jour/jour de semaine) d'un instant, heure de Paris. */
function localDayParts(timestamp: number): { year: number; month: number; day: number; weekday: number; dayKey: string } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHEDULE_TIMEZONE,
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

/** Timestamp UTC de `hour:minute` heure de Paris pour le jour calendaire de `dayTimestamp`. */
function zonedTimeForDay(dayTimestamp: number, hour: number, minute: number): number {
  const { year, month, day } = localDayParts(dayTimestamp);
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  // Deux passes pour converger malgré les transitions DST.
  let result = naive - tzOffsetMs(naive);
  result = naive - tzOffsetMs(result);
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
      const { weekday, dayKey } = localDayParts(dayTimestamp);
      if (template.weekday != null && weekday !== template.weekday) continue;
      const startAt = zonedTimeForDay(dayTimestamp, template.hour, template.minute);
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
    console.log(`[arenaScheduler] Arène programmée créée : ${occurrence.title} (${occurrence.scheduleKey}) — départ ${new Date(occurrence.startAt).toISOString()}`);
  }
  if (due.length) await manager.persist();
  return due.length;
}
