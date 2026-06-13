import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../i18n';

export default function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { i18n, t } = useTranslation();
  const current = (i18n.resolvedLanguage || i18n.language || 'en').slice(0, 2) as SupportedLanguage;

  return (
    <div
      className={`flex items-center gap-0.5 rounded-full border border-white/10 bg-white/[0.03] p-0.5 ${className}`}
      role="group"
      aria-label={t('lang.label')}
    >
      {SUPPORTED_LANGUAGES.map((lng) => {
        const active = current === lng;
        return (
          <button
            key={lng}
            type="button"
            onClick={() => void i18n.changeLanguage(lng)}
            aria-pressed={active}
            className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] transition-colors ${
              active ? 'bg-[#dc2626] text-white' : 'text-[#9a9aa6] hover:text-white'
            }`}
          >
            {t(`lang.${lng}`)}
          </button>
        );
      })}
    </div>
  );
}
