import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const CONTACT_EMAIL = 'breakout.pro.tv@gmail.com';

function BugIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 2l1.5 2.5" />
      <path d="M16 2l-1.5 2.5" />
      <rect x="8" y="6" width="8" height="12" rx="4" />
      <path d="M12 18v3" />
      <path d="M3 9h3" />
      <path d="M3 14h3" />
      <path d="M3 19l3-2" />
      <path d="M21 9h-3" />
      <path d="M21 14h-3" />
      <path d="M21 19l-3-2" />
    </svg>
  );
}

export default function LegalFooter() {
  const { t } = useTranslation();
  const location = useLocation();
  const fromCompete = location.pathname.startsWith('/compete');
  const suffix = fromCompete ? '?from=compete' : '';

  const bugReportHref = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
    t('footer.bugReportSubject'),
  )}&body=${encodeURIComponent(t('footer.bugReportBody'))}`;

  return (
    <footer
      className="border-t border-white/10 bg-[#050506] px-3 py-2 text-[9px] text-[#7f8796] sm:px-4 sm:py-3 sm:text-[10px]"
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="font-rajdhani text-[11px] font-bold tracking-wide text-white sm:text-sm">BTF Arena</span>
          <span className="text-[#454b57]">·</span>
          <span>© 2026 BTF</span>
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 sm:justify-end sm:gap-x-3 sm:gap-y-1">
          <a className="hidden transition-colors hover:text-white sm:inline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          <nav className="flex flex-wrap gap-x-2 gap-y-0.5 uppercase tracking-[0.1em] sm:gap-x-3 sm:gap-y-1 sm:tracking-[0.14em]">
            <Link className="transition-colors hover:text-white" to={`/cgu${suffix}`}>{t('footer.cgu')}</Link>
            <Link className="transition-colors hover:text-white" to={`/confidentialite${suffix}`}>{t('footer.privacy')}</Link>
            <Link className="hidden transition-colors hover:text-white sm:inline" to={`/mentions-legales${suffix}`}>{t('footer.legalNotice')}</Link>
            <Link className="transition-colors hover:text-white" to={`/risques${suffix}`}>{t('footer.risks')}</Link>
            <Link className="transition-colors hover:text-white" to={`/reglement${suffix}`}>{t('footer.rules')}</Link>
          </nav>
          <a
            href={bugReportHref}
            className="inline-flex items-center gap-1.5 rounded-md border border-red-500/40 bg-red-600/90 px-2.5 py-1 font-semibold uppercase tracking-[0.1em] text-white transition-colors hover:bg-red-500 sm:tracking-[0.14em]"
          >
            <BugIcon className="h-3.5 w-3.5" />
            {t('footer.reportBug')}
          </a>
        </div>
      </div>
    </footer>
  );
}
