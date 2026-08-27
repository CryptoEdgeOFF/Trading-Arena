/**
 * Les feeds bougies (Binance / iTick / flush) ne doivent tourner que s’il
 * existe une arène live, un départ imminent, ou l’événement LIVE.
 * Configuré depuis index.ts une fois les managers prêts.
 */

let extraNeed: () => boolean = () => false;
let competitionNeed: () => boolean = () => false;

export function configureLiveMarketNeed(options: {
  extraNeed?: () => boolean;
  competitionNeed: () => boolean;
}): void {
  competitionNeed = options.competitionNeed;
  extraNeed = options.extraNeed || (() => false);
}

export function isLiveMarketNeeded(): boolean {
  try {
    if (extraNeed()) return true;
  } catch {
    /* managers pas encore prêts */
  }
  try {
    return competitionNeed();
  } catch {
    return false;
  }
}
