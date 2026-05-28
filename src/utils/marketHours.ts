/**
 * Horaires d'ouverture des marchés (UTC). Crypto = 24/7.
 * Forex / métaux : semaine FX (dim 22h → ven 22h UTC).
 * Indices US : lun–ven 14h30–21h UTC (session cash NY).
 * Pétrole : lun–ven 01h–22h UTC.
 */

export type MarketScheduleKind = 'always' | 'forex_week' | 'us_index' | 'energy';

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
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const mins = utcDayMinutes(now);
  const start = 14 * 60 + 30;
  const end = 21 * 60;
  return mins >= start && mins < end;
}

function isEnergyOpen(now: Date): boolean {
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const mins = utcDayMinutes(now);
  return mins >= 60 && mins < 22 * 60;
}

export function scheduleForPair(
  pair: string,
  category?: string,
  instrumentCode?: string,
): MarketScheduleKind {
  const cat = (category || 'crypto').toLowerCase();
  if (cat === 'crypto') return 'always';
  if (cat === 'forex') return 'forex_week';
  if (cat === 'indices' || cat === 'index') return 'us_index';
  if (cat === 'commodities' || cat === 'commodity') {
    const code = (instrumentCode || pair.split('/')[0] || '').toUpperCase();
    if (code === 'USOIL' || code === 'UKOIL' || code === 'WTI' || code === 'BRENTOIL') {
      return 'energy';
    }
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
    case 'energy':
      open = isEnergyOpen(now);
      break;
    default:
      open = true;
  }

  return {
    open,
    label: open ? '' : 'Marché fermé',
  };
}
