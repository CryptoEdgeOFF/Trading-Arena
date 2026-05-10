import { Link, useLocation } from 'react-router-dom';

const CONTACT_EMAIL = 'breakout.pro.tv@gmail.com';

export default function LegalFooter() {
  const location = useLocation();
  const fromCompete = location.pathname.startsWith('/compete');
  const suffix = fromCompete ? '?from=compete' : '';

  return (
    <footer className="border-t border-white/10 bg-[#050506] px-4 py-3 text-[#7f8796]">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 text-[10px] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-rajdhani text-sm font-bold tracking-wide text-white">BTF Arena</span>
          <span className="text-[#454b57]">·</span>
          <span>© 2026 BTF</span>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:justify-end">
          <a className="transition-colors hover:text-white" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          <nav className="flex flex-wrap gap-x-3 gap-y-1 uppercase tracking-[0.14em]">
            <Link className="transition-colors hover:text-white" to={`/cgu${suffix}`}>CGU</Link>
            <Link className="transition-colors hover:text-white" to={`/confidentialite${suffix}`}>Confidentialité</Link>
            <Link className="transition-colors hover:text-white" to={`/mentions-legales${suffix}`}>Mentions légales</Link>
            <Link className="transition-colors hover:text-white" to={`/risques${suffix}`}>Risques</Link>
            <Link className="transition-colors hover:text-white" to="/compete/admin">Admin</Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
