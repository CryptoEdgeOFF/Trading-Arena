import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './locales/en';
import { fr } from './locales/fr';

export const SUPPORTED_LANGUAGES = ['en', 'fr'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const LANGUAGE_STORAGE_KEY = 'btf-lang';

/**
 * Langue initiale résolue de façon SYNCHRONE et déterministe :
 *  - anglais par défaut pour TOUT LE MONDE (jamais la langue du navigateur) ;
 *  - sauf si un choix explicite a été mémorisé dans les paramètres.
 * On évite ainsi tout clignotement EN ↔ FR au chargement (détecteur async).
 */
function resolveInitialLanguage(): SupportedLanguage {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored && (SUPPORTED_LANGUAGES as readonly string[]).includes(stored.slice(0, 2))) {
      return stored.slice(0, 2) as SupportedLanguage;
    }
  } catch {
    // localStorage indisponible (mode privé strict) → repli anglais.
  }
  return 'en';
}

const initialLanguage = resolveInitialLanguage();

void i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      fr: { translation: fr },
    },
    // Langue figée à l'init (pas de détection navigateur) : anglais par défaut,
    // le visiteur peut basculer en français depuis les paramètres uniquement.
    lng: initialLanguage,
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
    interpolation: { escapeValue: false },
  });

// Persiste le choix dès qu'il change (depuis les paramètres) pour qu'il survive
// aux rechargements, et garantit une valeur stockée même au premier passage.
function persistLanguage(lng: string) {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lng.slice(0, 2));
  } catch {
    // ignore
  }
}
persistLanguage(initialLanguage);
i18n.on('languageChanged', persistLanguage);

export default i18n;
