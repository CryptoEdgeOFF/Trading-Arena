import { SUPPORTED_LANGUAGES, useI18n } from '../i18n'

export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { lang, setLang, t } = useI18n()
  return (
    <div className={`language-switcher ${className}`} role="group" aria-label={t('lang.label')}>
      {SUPPORTED_LANGUAGES.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={lang === option}
          className={lang === option ? 'is-active' : ''}
          onClick={() => setLang(option)}
        >
          {t(`lang.${option}`)}
        </button>
      ))}
    </div>
  )
}
