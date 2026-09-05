/** Reset du drawdown journalier : 09:00 Europe/Paris (CET/CEST). */
export const DRAWDOWN_TZ = 'Europe/Paris';
export const DRAWDOWN_RESET_HOUR = 9;

function parisParts(ts: number): { year: number; month: number; day: number; hour: number } {
  const map = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: DRAWDOWN_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(ts))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Clé de journée drawdown ('YYYY-MM-DD') : bascule à 09:00 heure de Paris. */
export function drawdownDayKey(ts: number): string {
  let { year, month, day, hour } = parisParts(ts);
  if (hour < DRAWDOWN_RESET_HOUR) {
    const prev = parisParts(Date.UTC(year, month - 1, day, 12, 0, 0) - 24 * 60 * 60 * 1000);
    year = prev.year;
    month = prev.month;
    day = prev.day;
  }
  return `${year}-${pad2(month)}-${pad2(day)}`;
}
