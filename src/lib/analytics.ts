/**
 * Google Analytics 4 — couche centralisée et typée.
 *
 * Tout passe par ce module : aucun appel `gtag` direct ne doit être dispersé
 * dans les composants. On expose :
 *  - `initAnalytics()`     : charge gtag.js une seule fois (appelé au boot).
 *  - `trackPageView()`     : page vue (SPA, sur changement de route).
 *  - `analytics.*`         : événements métier fortement typés.
 *
 * Le suivi est désactivé en local (localhost) pour ne pas polluer les données ;
 * en dev, les événements sont loggés en console (`debug`).
 */

export const GA_MEASUREMENT_ID = 'G-LKF3K1ERDQ';

type GtagParams = Record<string, string | number | boolean | undefined | null>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const isBrowser = typeof window !== 'undefined';

/** Désactivé sur localhost / réseaux locaux pour garder des données propres. */
const TRACKING_ENABLED =
  isBrowser && !/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(window.location.hostname);

const DEBUG = isBrowser && Boolean((import.meta as any).env?.DEV);

let initialized = false;

function debugLog(...args: unknown[]): void {
  if (DEBUG) console.info('[analytics]', ...args);
}

/** Injecte gtag.js et configure GA4. Idempotent. */
export function initAnalytics(): void {
  if (initialized || !isBrowser) return;
  initialized = true;

  if (!TRACKING_ENABLED) {
    debugLog('tracking désactivé (localhost)');
    return;
  }

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag('js', new Date());
  // send_page_view: false → on envoie les page_view manuellement par route (SPA).
  window.gtag('config', GA_MEASUREMENT_ID, { send_page_view: false });

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(script);

  debugLog('GA4 initialisé', GA_MEASUREMENT_ID);
}

/** Nettoie les paramètres (retire les valeurs nulles/undefined). */
function clean(params?: GtagParams): GtagParams {
  if (!params) return {};
  const out: GtagParams = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

/** Envoie un événement GA4 générique. */
export function trackEvent(name: string, params?: GtagParams): void {
  const payload = clean(params);
  debugLog('event', name, payload);
  if (!TRACKING_ENABLED || !window.gtag) return;
  window.gtag('event', name, payload);
}

/** Page vue (SPA). À appeler à chaque changement de route. */
export function trackPageView(path: string, title?: string): void {
  debugLog('page_view', path);
  if (!TRACKING_ENABLED || !window.gtag) return;
  window.gtag('event', 'page_view', {
    page_path: path,
    page_location: window.location.origin + path,
    page_title: title ?? document.title,
  });
}

/**
 * Événements métier fortement typés.
 * Noms d'événements en snake_case (convention GA4).
 */
export const analytics = {
  /** Inscription terminée (OTP + SMS validés). */
  signUp(method = 'email'): void {
    trackEvent('sign_up', { method });
  },

  /** Connexion réussie. */
  login(method = 'email'): void {
    trackEvent('login', { method });
  },

  /** Participation à une compétition validée. */
  competitionJoin(params: { competitionId: string; competitionName?: string; sponsor?: string }): void {
    trackEvent('competition_join', {
      competition_id: params.competitionId,
      competition_name: params.competitionName,
      sponsor: params.sponsor,
    });
  },

  /** Ordre passé dans le terminal (le cœur de l'activité de trading). */
  tradePlaced(params: {
    pair: string;
    side: 'long' | 'short';
    orderType: 'market' | 'limit';
    leverage?: number;
    platform?: string;
    competitionId?: string | null;
  }): void {
    trackEvent('trade_placed', {
      pair: params.pair,
      side: params.side,
      order_type: params.orderType,
      leverage: params.leverage,
      platform: params.platform,
      competition_id: params.competitionId ?? undefined,
    });
  },

  /** Clic sur le lien d'une promotion / partenaire (referral). */
  promoClick(params: { partner: string; category?: string; url?: string }): void {
    trackEvent('promo_click', {
      partner: params.partner,
      category: params.category,
      link_url: params.url,
    });
  },

  /** Copie d'un code promo partenaire. */
  promoCodeCopy(params: { partner: string; code: string }): void {
    trackEvent('promo_code_copy', {
      partner: params.partner,
      promo_code: params.code,
    });
  },

  /** Partage / téléchargement d'une carte de performance. */
  shareCard(params: { type: string; channel?: string }): void {
    trackEvent('share_card', {
      card_type: params.type,
      channel: params.channel,
    });
  },
};
