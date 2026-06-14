/**
 * Chemin secret des pages admin (front).
 *
 * Défini via `VITE_ADMIN_PATH` (.env). On en dérive les routes admin et les
 * liens internes. Les anciens chemins devinables (`/admin`, `/compete/admin`)
 * ne sont plus montés : ils retombent sur le catch-all (redirection accueil).
 *
 * ⚠️ Une variable `VITE_*` est compilée dans le bundle client : ce chemin
 * relève de l'obscurité (anti-devinette / anti-indexation), pas du secret
 * absolu. La vraie protection reste `ADMIN_CODE` vérifié côté serveur.
 */

const RAW = (import.meta.env.VITE_ADMIN_PATH ?? '').trim().replace(/^\/+|\/+$/g, '');

/** Segment brut, ex. `ctrl-26c5c5b449` (vide si non configuré). */
export const ADMIN_PATH = RAW;

/** Admin activé uniquement si un chemin secret est configuré. */
export const ADMIN_ENABLED = Boolean(ADMIN_PATH);

/** Route racine du panneau admin live/roster, ex. `/ctrl-26c5c5b449`. */
export const ADMIN_BASE = ADMIN_ENABLED ? `/${ADMIN_PATH}` : '/compete';

/** Route d'admin des arènes online, ex. `/ctrl-26c5c5b449/arenes`. */
export const ARENA_ADMIN_PATH = ADMIN_ENABLED ? `/${ADMIN_PATH}/arenes` : '/compete';

/** Route d'admin des promotions (Trade Live Bonus), ex. `/ctrl-…/promotions`. */
export const PROMOTIONS_ADMIN_PATH = ADMIN_ENABLED ? `/${ADMIN_PATH}/promotions` : '/compete';

/** Route d'admin des emails (suivi & configuration), ex. `/ctrl-…/emails`. */
export const EMAILS_ADMIN_PATH = ADMIN_ENABLED ? `/${ADMIN_PATH}/emails` : '/compete';

/** Version échappée pour insertion dans une RegExp. */
export const ADMIN_PATH_REGEX = ADMIN_PATH
  ? ADMIN_PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  : null;
