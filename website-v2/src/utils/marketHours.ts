/**
 * Horaires d'ouverture des marchés. Crypto = 24/7.
 * Forex / métaux : semaine FX (dim 22h → ven 22h UTC).
 * Indices US + WTI : session cash NY (lun–ven 9h30–16h heure de New York),
 * calculée sur le fuseau America/New_York pour suivre automatiquement
 * l'heure d'été/hiver américaine.
 */

const ET_TIME_ZONE = 'America/New_York';
const ET_WEEKDAYS: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** Jour de la semaine (0=dim) et minutes depuis minuit, exprimés en heure de New York. */
function getEtParts(now: Date): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TIME_ZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  let weekday = 'Mon';
  let hour = 0;
  let minute = 0;
  for (const part of parts) {
    if (part.type === 'weekday') weekday = part.value;
    else if (part.type === 'hour') hour = parseInt(part.value, 10);
    else if (part.type === 'minute') minute = parseInt(part.value, 10);
  }
  if (hour === 24) hour = 0; // certains environnements rendent minuit en "24"
  return { day: ET_WEEKDAYS[weekday] ?? 1, minutes: hour * 60 + minute };
}

export type MarketScheduleKind = 'always' | 'forex_week' | 'us_index';

export interface MarketSessionInfo {
  open: boolean;
  /** Libellé affiché quand le marché est fermé. */
  label: string;
}

function utcDayMinutes(now: Date): number {
  return now.getUTCHours() * 60 + now.getUTCMinutes();
}

function isForexWeekOpen(now: Date): boolean {
  const day = now.getUTCDay(); // 0=dim … 6=sam
  const mins = utcDayMinutes(now);
  const closeAt = 22 * 60; // ven 22:00 UTC
  if (day === 6) return false;
  if (day === 0 && mins < closeAt) return false;
  if (day === 5 && mins >= closeAt) return false;
  return true;
}

function isUsIndexOpen(now: Date): boolean {
  // Session cash NYSE : 9h30–16h00 heure de New York, lun–ven.
  const { day, minutes } = getEtParts(now);
  if (day === 0 || day === 6) return false;
  const start = 9 * 60 + 30; // 9h30 ET
  const end = 16 * 60;        // 16h00 ET
  return minutes >= start && minutes < end;
}

export function scheduleForPair(
  pair: string,
  category?: string,
  instrumentCode?: string,
): MarketScheduleKind {
  const cat = (category || 'crypto').toLowerCase();
  if (cat === 'crypto') return 'always';
  if (cat === 'forex') return 'forex_week';
  // Indices : flux iTick CFD (NAS100, SPX500USD, US30USD) ouverts ~24h en
  // semaine. On utilise donc l'horaire « semaine entière, fermé le week-end »
  // (dim 22h UTC → ven 22h UTC) plutôt que la session cash NYSE 9h30–16h ET.
  if (cat === 'indices' || cat === 'index') return 'forex_week';
  if (cat === 'commodities' || cat === 'commodity') {
    // Métaux + énergie : flux CFD iTick (XAUUSD, XAGUSD, USOIL) ouverts
    // ~24h en semaine. WTI inclus → on aligne tout sur l'horaire
    // « semaine entière, fermé le week-end » (plus de session cash NYSE).
    void instrumentCode;
    return 'forex_week';
  }
  return 'always';
}

export function getMarketSession(
  pair: string,
  options: { category?: string; code?: string } = {},
  now: Date = new Date(),
): MarketSessionInfo {
  const kind = scheduleForPair(pair, options.category, options.code);
  if (kind === 'always') {
    return { open: true, label: '' };
  }

  let open = false;
  switch (kind) {
    case 'forex_week':
      open = isForexWeekOpen(now);
      break;
    case 'us_index':
      open = isUsIndexOpen(now);
      break;
    default:
      open = true;
  }

  return {
    open,
    label: open ? '' : 'Marché fermé',
  };
}
