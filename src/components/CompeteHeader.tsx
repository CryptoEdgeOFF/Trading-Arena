import { useEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AvatarImage } from './OptimizedImage';
import {
  COMPETE_SESSION_KEY,
  readCachedCompeteUser,
  writeCachedCompeteUser,
  type CompeteSessionUser,
} from '../lib/competeSession';

const ARENAS_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 9l9-6 9 6M5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" />
  </svg>
);
const JOURNAL_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 17l5-6 4 3 6-8M3 21h18" />
  </svg>
);
const LEADERBOARD_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 20V10M10 20V4M16 20v-6M20 20H4" />
  </svg>
);
const BONUS_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 12v8H4v-8M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 1 1 2.1-3.85M12 7h4.5a2.5 2.5 0 1 0-2.1-3.85" />
  </svg>
);
const PROFILE_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 21a8 8 0 0 0-16 0" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);
const SETTINGS_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </svg>
);
const LOGOUT_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
  </svg>
);

/** Scroll doux vers une section de la home en tenant compte du header sticky. */
function scrollToSection(targetId: string) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const header = document.querySelector('.compete-header') as HTMLElement | null;
  const headerOffset = (header?.offsetHeight ?? 64) + 8;
  const top = window.scrollY + target.getBoundingClientRect().top - headerOffset;
  window.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' });
}

interface NavItemDef {
  to: string;
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

function NavItem({ item }: { item: NavItemDef }) {
  return (
    <Link
      to={item.to}
      onClick={item.onClick}
      aria-current={item.active ? 'page' : undefined}
      className={`group relative isolate flex shrink-0 items-center gap-2 overflow-hidden rounded-xl border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.13em] transition-all duration-200 sm:px-3.5 sm:text-[11px] ${
        item.active
          ? 'border-[#dc2626]/55 bg-[#dc2626]/15 text-white shadow-[0_8px_24px_-14px_rgba(220,38,38,0.9)]'
          : 'border-white/[0.08] bg-gradient-to-b from-white/[0.07] to-white/[0.015] text-[#a5a5b0] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] hover:-translate-y-0.5 hover:border-[#dc2626]/55 hover:text-white hover:shadow-[0_10px_28px_-14px_rgba(220,38,38,0.85)]'
      }`}
    >
      {!item.active && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-2/3 bg-[radial-gradient(circle_at_50%_140%,rgba(220,38,38,0.5),transparent_72%)] opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
      )}
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-lg ring-1 ring-inset transition-colors duration-200 ${
          item.active
            ? 'bg-[#dc2626]/30 text-white ring-[#dc2626]/45'
            : 'bg-[#dc2626]/15 text-[#fca5a5] ring-[#dc2626]/20 group-hover:bg-[#dc2626]/30 group-hover:text-white group-hover:ring-[#dc2626]/45'
        }`}
      >
        {item.icon}
      </span>
      <span className="whitespace-nowrap">{item.label}</span>
    </Link>
  );
}

function MobileNavItem({ item, onNavigate }: { item: NavItemDef; onNavigate: () => void }) {
  return (
    <Link
      to={item.to}
      aria-current={item.active ? 'page' : undefined}
      onClick={(event) => {
        item.onClick?.(event);
        onNavigate();
      }}
      className={`flex items-center gap-3 rounded-xl px-3 py-3 text-xs font-bold uppercase tracking-[0.12em] transition-colors ${
        item.active ? 'bg-[#dc2626]/15 text-white' : 'text-[#b8b8c2] hover:bg-white/[0.04] hover:text-white'
      }`}
    >
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-lg ring-1 ring-inset transition-colors ${
          item.active ? 'bg-[#dc2626]/30 text-white ring-[#dc2626]/45' : 'bg-[#dc2626]/12 text-[#fca5a5] ring-[#dc2626]/20'
        }`}
      >
        {item.icon}
      </span>
      <span>{item.label}</span>
      {item.active && (
        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#dc2626] shadow-[0_0_10px_rgba(220,38,38,0.9)]" />
      )}
    </Link>
  );
}

/**
 * Header unique et harmonisé de la plateforme Compete, partagé par toutes les
 * pages (accueil, journal, leaderboard global, profil public...).
 *
 * - Navigation principale en pills cohérentes avec état actif.
 * - Un seul menu compte (avatar) regroupant Réglages / Déconnexion.
 *
 * `user` / `onLogout` sont optionnels : si absents, le header lit la session
 * en cache et gère lui-même la déconnexion (cas des pages secondaires).
 */
export default function CompeteHeader({
  user: userProp,
  onLogout,
}: {
  user?: CompeteSessionUser | null;
  onLogout?: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [cachedUser, setCachedUser] = useState<CompeteSessionUser | null>(() =>
    userProp !== undefined ? userProp : readCachedCompeteUser(),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Si le parent ne pilote pas la session, on garde la version cache à jour.
  useEffect(() => {
    if (userProp !== undefined) {
      setCachedUser(userProp);
    }
  }, [userProp]);

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(event: globalThis.MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  // On referme tout dès qu'on change de page.
  useEffect(() => {
    setMenuOpen(false);
    setMobileOpen(false);
  }, [pathname]);

  // Bloque le scroll de la page tant que le drawer mobile est ouvert.
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  const user = cachedUser;
  const isHome = pathname === '/compete';

  function handleLogout() {
    setMenuOpen(false);
    setMobileOpen(false);
    if (onLogout) {
      onLogout();
      return;
    }
    window.localStorage.removeItem(COMPETE_SESSION_KEY);
    writeCachedCompeteUser(null);
    setCachedUser(null);
    navigate('/compete');
  }

  const items: NavItemDef[] = [
    {
      to: '/compete',
      icon: ARENAS_ICON,
      label: t('header.arenas'),
      active: isHome,
      onClick: (event) => {
        if (isHome) {
          event.preventDefault();
          scrollToSection('arenas');
        }
      },
    },
    {
      to: '/compete/global-leaderboard',
      icon: LEADERBOARD_ICON,
      label: t('user.globalLeaderboard'),
      active: pathname.startsWith('/compete/global-leaderboard'),
    },
  ];
  if (user) {
    items.push({
      to: '/compete/journal',
      icon: JOURNAL_ICON,
      label: t('user.tradeJournal'),
      active: pathname.startsWith('/compete/journal'),
    });
  }
  items.push({
    to: '/compete/bonus',
    icon: BONUS_ICON,
    label: t('bonus.navLabel'),
    active: pathname.startsWith('/compete/bonus'),
  });
  if (user) {
    items.push({
      to: `/compete/player/${user.id}`,
      icon: PROFILE_ICON,
      label: t('user.publicProfile'),
      active: pathname.startsWith('/compete/player/'),
    });
  }

  return (
    <header
      className="compete-header sticky top-0 z-50 bg-[#050507]/95 backdrop-blur-xl sm:bg-[#050507]/80 sm:px-5 sm:pt-3"
      style={{ paddingTop: 'max(0px, env(safe-area-inset-top))' }}
    >
      <div className="relative z-10 mx-auto flex max-w-7xl items-center justify-between gap-2 border-b border-white/10 bg-[#050507] px-3 py-2 shadow-[0_18px_60px_-42px_rgba(220,38,38,0.65)] sm:rounded-2xl sm:border sm:border-white/10 sm:bg-[#060609]/85 sm:px-4 sm:py-3 sm:backdrop-blur-2xl md:px-6">
        <Link to="/compete" className="group flex shrink-0 items-center">
          <img
            src="/assets/pictures/BTF_ARENA_logo.png"
            alt="BTF Arena"
            className="h-10 w-auto object-contain transition-transform duration-200 group-hover:scale-[1.03] sm:h-11"
          />
        </Link>

        {/* Navigation principale (desktop) */}
        <nav className="hidden items-center gap-2 rounded-2xl border border-white/[0.06] bg-[#08080b]/60 p-1.5 lg:flex">
          {items.map((item) => (
            <NavItem key={item.to} item={item} />
          ))}
        </nav>

        {/* Menu compte desktop (un seul point d'entrée) */}
        <div className="hidden shrink-0 items-center gap-2 lg:flex">
          {user ? (
            <div ref={menuRef} className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="flex items-center gap-2 rounded-full border border-[#232329] bg-[#0c0c10] py-1.5 pl-2 pr-3 transition-colors hover:border-[#dc2626]/40"
              >
                {user.avatarUrl ? (
                  <AvatarImage key={user.avatarUrl} src={user.avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover" sizePx={24} />
                ) : (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-[#dc2626] to-[#7f1d1d] text-[11px] font-bold uppercase text-white">
                    {user.name.slice(0, 2)}
                  </span>
                )}
                <span className="max-w-[120px] truncate text-sm text-[#b8b8c2]">{user.name}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={`text-[#71717a] transition-transform duration-200 ${menuOpen ? 'rotate-180' : ''}`} aria-hidden="true">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-[calc(100%+8px)] z-50 w-52 overflow-hidden rounded-2xl border border-[#232329] bg-[#08080b] p-1.5 shadow-[0_24px_70px_-30px_rgba(0,0,0,0.95)]"
                >
                  <div className="border-b border-white/5 px-3 py-2">
                    <div className="micro text-[9px] text-[#71717a]">{t('header.account')}</div>
                    <div className="truncate text-sm font-semibold text-white">{user.name}</div>
                  </div>
                  <Link
                    to="/compete/settings"
                    onClick={() => setMenuOpen(false)}
                    role="menuitem"
                    className="mt-1.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] text-[#b8b8c2] transition-colors hover:bg-[#dc2626]/10 hover:text-white"
                  >
                    {SETTINGS_ICON}
                    {t('header.settings')}
                  </Link>
                  <button
                    type="button"
                    onClick={handleLogout}
                    role="menuitem"
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] text-[#b8b8c2] transition-colors hover:bg-[#dc2626]/10 hover:text-white"
                  >
                    {LOGOUT_ICON}
                    {t('header.logout')}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link to="/compete" className="blood-cta px-4 py-2 text-xs uppercase tracking-[0.14em]">
              {t('header.login')}
            </Link>
          )}
        </div>

        {/* Bouton menu (tablette / mobile) */}
        <button
          type="button"
          onClick={() => setMobileOpen((open) => !open)}
          aria-haspopup="menu"
          aria-expanded={mobileOpen}
          aria-label={t('header.menu')}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-[#0c0c10] text-white transition-colors hover:border-[#dc2626]/45 lg:hidden"
        >
          {mobileOpen ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          )}
        </button>
      </div>

      {/* Voile plein écran (porté dans body pour échapper au backdrop-filter du header). */}
      {mobileOpen &&
        createPortal(
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          />,
          document.body,
        )}

      {/* Drawer mobile : navigation + compte regroupés */}
      {mobileOpen && (
        <div className="lg:hidden">
          <div className="relative z-50 mx-auto mt-2 max-w-7xl px-3 sm:px-0">
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#08080b] p-2 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.95)]">
              {user && (
                <div className="mb-1 flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5">
                  {user.avatarUrl ? (
                    <AvatarImage key={user.avatarUrl} src={user.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" sizePx={36} />
                  ) : (
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#dc2626] to-[#7f1d1d] text-xs font-bold uppercase text-white">
                      {user.name.slice(0, 2)}
                    </span>
                  )}
                  <div className="min-w-0">
                    <div className="micro text-[9px] text-[#71717a]">{t('header.account')}</div>
                    <div className="truncate text-sm font-semibold text-white">{user.name}</div>
                  </div>
                </div>
              )}

              <nav className="flex flex-col gap-1">
                {items.map((item) => (
                  <MobileNavItem key={item.to} item={item} onNavigate={() => setMobileOpen(false)} />
                ))}
              </nav>

              <div className="my-2 h-px bg-white/[0.06]" />

              {user ? (
                <div className="flex flex-col gap-1">
                  <Link
                    to="/compete/settings"
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center gap-3 rounded-xl px-3 py-3 text-xs font-bold uppercase tracking-[0.12em] text-[#b8b8c2] transition-colors hover:bg-[#dc2626]/10 hover:text-white"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.04] text-[#a5a5b0]">{SETTINGS_ICON}</span>
                    {t('header.settings')}
                  </Link>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-xs font-bold uppercase tracking-[0.12em] text-[#b8b8c2] transition-colors hover:bg-[#dc2626]/10 hover:text-white"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.04] text-[#a5a5b0]">{LOGOUT_ICON}</span>
                    {t('header.logout')}
                  </button>
                </div>
              ) : (
                <Link
                  to="/compete"
                  onClick={() => setMobileOpen(false)}
                  className="blood-cta flex items-center justify-center px-4 py-3 text-xs uppercase tracking-[0.14em]"
                >
                  {t('header.login')}
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
