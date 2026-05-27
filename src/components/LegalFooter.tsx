import { Link, useLocation } from 'react-router-dom';

const CONTACT_EMAIL = 'breakout.pro.tv@gmail.com';

export default function LegalFooter() {
  const location = useLocation();
  const fromCompete = location.pathname.startsWith('/compete');
  const suffix = fromCompete ? '?from=compete' : '';

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
            <Link className="transition-colors hover:text-white" to={`/cgu${suffix}`}>CGU</Link>
            <Link className="transition-colors hover:text-white" to={`/confidentialite${suffix}`}>Confidentialité</Link>
            <Link className="hidden transition-colors hover:text-white sm:inline" to={`/mentions-legales${suffix}`}>Mentions légales</Link>
            <Link className="transition-colors hover:text-white" to={`/risques${suffix}`}>Risques</Link>
            <Link className="hidden transition-colors hover:text-white sm:inline" to="/compete/admin">Admin</Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
