import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { en } from './en'
import { fr } from './fr'

export const SUPPORTED_LANGUAGES = ['en', 'fr'] as const
export type Lang = (typeof SUPPORTED_LANGUAGES)[number]
export const LANGUAGE_STORAGE_KEY = 'btf-lang'

type Dictionary = typeof en
type Vars = Record<string, string | number>

function deviceLanguage(): Lang {
  const candidates = [
    ...(typeof navigator !== 'undefined' ? navigator.languages || [] : []),
    typeof navigator !== 'undefined' ? navigator.language : '',
    typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().locale : '',
  ]
  return candidates.some((value) => String(value).toLowerCase().startsWith('fr')) ? 'fr' : 'en'
}

function resolveInitialLanguage(): Lang {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    if (stored && (SUPPORTED_LANGUAGES as readonly string[]).includes(stored.slice(0, 2))) {
      return stored.slice(0, 2) as Lang
    }
  } catch {
    // localStorage indisponible
  }
  return deviceLanguage()
}

function lookup(dict: Dictionary, path: string): string | undefined {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current && typeof current === 'object' && key in current) return (current as Record<string, unknown>)[key]
    return undefined
  }, dict) as string | undefined
}

function interpolate(template: string, vars?: Vars) {
  if (!vars) return template
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(vars[key] ?? ''))
}

const dictionaries: Record<Lang, Dictionary> = { en, fr }

type I18nContextValue = {
  lang: Lang
  locale: string
  setLang: (lang: Lang) => void
  t: (key: string, vars?: Vars) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(resolveInitialLanguage)

  const value = useMemo<I18nContextValue>(() => {
    const dict = dictionaries[lang]
    return {
      lang,
      locale: lang === 'fr' ? 'fr-FR' : 'en-US',
      setLang(next) {
        setLangState(next)
        try { localStorage.setItem(LANGUAGE_STORAGE_KEY, next) } catch { /* ignore */ }
      },
      t(key, vars) {
        return interpolate(lookup(dict, key) ?? lookup(en, key) ?? key, vars)
      },
    }
  }, [lang])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used inside I18nProvider')
  return context
}

export function translateTitle(lang: Lang, id?: string, fallback?: string) {
  if (!id) return fallback || ''
  return lookup(dictionaries[lang], `titles.${id}`) || fallback || id
}

export function translateFrame(lang: Lang, id?: string, fallback?: string) {
  if (!id) return fallback || ''
  return lookup(dictionaries[lang], `frames.${id}`) || fallback || id
}
