import { useEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from './LanguageSwitcher';
import { AvatarImage } from './OptimizedImage';
import {
  COMPETE_SESSION_EVENT,
  COMPETE_SESSION_KEY,
  mergeSessionUser,
  readCachedCompeteUser,
  writeCachedCompeteUser,
  type CompeteSessionUser,
} from '../lib/competeSession';
import { NEWS_READ_EVENT, hasUnreadNews, markNewsRead } from '../lib/newsRead';
import { fetchPublicNews } from '../lib/publicNews';
import { useIsMobileWeb } from '../lib/mobileWeb';

const ARENAS_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 9l9-6 9 6M5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" />
  </svg>
);
const LIVE_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 12h.01M8.5 8.5a5 5 0 0 0 0 7m7-7a5 5 0 0 1 0 7M5.5 5.5a9 9 0 0 0 0 13m13-13a9 9 0 0 1 0 13" />
  </svg>
);
const TRADE_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 19V9m0 0L2.5 11.5M5 9l2.5 2.5M19 5v10m0 0 2.5-2.5M19 15l-2.5-2.5M10 7h4m-4 5h4m-4 5h4" />
  </svg>
);
const JOURNAL_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 17l5-6 4 3 6-8M3 21h18" />
  </svg>
);
const RANK_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21 1.18.54 2.03 2.03 2.03 3.79M18 2H6v7a6 6 0 0 0 12 0V2Z" />
  </svg>
);
const BONUS_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 12v8H4v-8M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 1 1 2.1-3.85M12 7h4.5a2.5 2.5 0 1 0-2.1-3.85" />
  </svg>
);
const NEWS_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 4h14v16H5V4Zm3 4h8M8 12h8m-8 4h5" />
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
const PAYOUT_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <path d="M2 10h20M7 15h.01M11 15h2" />
  </svg>
);
const LOGOUT_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
  </svg>
);

interface NavItemDef {
  to: string;
  icon: ReactNode;
  label: string;
  active: boolean;
  unread?: boolean;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

function NewsBell() {
  const { t } = useTranslation();
  return (
    <span className="relative ml-0.5 inline-flex h-4 w-4 items-center justify-center text-[#ff5268]" aria-label={t('header.unreadNews')} title={t('header.unreadNews')}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 22a2.2 2.2 0 0 0 2.2-2.2h-4.4A2.2 2.2 0 0 0 12 22Zm8-6v-5a8 8 0 1 0-16 0v5l-1.8 1.8A1 1 0 0 0 3 15h18a1 1 0 0 0 .8-1.6L20 16Z" />
      </svg>
      <i className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-[#ef233c] shadow-[0_0_8px_rgba(239,35,60,0.9)]" />
    </span>
  );
}

function NavItem({ item }: { item: NavItemDef }) {
  return (
    <Link
      to={item.to}
      onClick={item.onClick}
      aria-current={item.active ? 'page' : undefined}
      className={`group relative flex shrink-0 items-center gap-2 px-3 py-2.5 text-[10px] font-bold uppercase tracking-[0.14em] transition-colors duration-200 sm:text-[11px] ${
        item.active
          ? 'text-white'
          : 'text-[#77717a] hover:text-white'
      }`}
    >
      <span className={`absolute inset-x-3 bottom-0 h-px origin-left bg-[#ef233c] transition-transform duration-200 ${item.active ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100'}`} />
      <span
        className={`flex h-5 w-5 items-center justify-center transition-colors duration-200 ${
          item.active
            ? 'text-[#ff5268]'
            : 'text-[#625d65] group-hover:text-[#ff5268]'
        }`}
      >
        {item.icon}
      </span>
      <span className="whitespace-nowrap">{item.label}</span>
      {item.unread && <NewsBell />}
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
      className={`flex items-center gap-3 rounded-[3px] px-3 py-3 text-xs font-extrabold italic uppercase tracking-[0.12em] transition-colors ${
        item.active ? 'bg-[#dc2626]/15 text-white' : 'text-[#b8b8c2] hover:bg-white/[0.04] hover:text-white'
      }`}
    >
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-[3px] ring-1 ring-inset transition-colors ${
          item.active ? 'bg-[#dc2626]/30 text-white ring-[#dc2626]/45' : 'bg-[#dc2626]/12 text-[#fca5a5] ring-[#dc2626]/20'
        }`}
      >
        {item.icon}
      </span>
      <span>{item.label}</span>
      {item.unread && <NewsBell />}
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
  const isMobileWeb = useIsMobileWeb();
  const [cachedUser, setCachedUser] = useState<CompeteSessionUser | null>(() =>
    userProp !== undefined ? userProp : readCachedCompeteUser(),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unreadNews, setUnreadNews] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const latestNewsAtRef = useRef(0);

  // Si le parent ne pilote pas la session, on garde la version cache à jour.
  useEffect(() => {
    if (userProp !== undefined) {
      setCachedUser((current) => userProp ? mergeSessionUser(current, userProp) : null);
    }
  }, [userProp]);

  useEffect(() => {
    const syncUser = () => setCachedUser(readCachedCompeteUser());
    window.addEventListener(COMPETE_SESSION_EVENT, syncUser);
    window.addEventListener('storage', syncUser);
    return () => {
      window.removeEventListener(COMPETE_SESSION_EVENT, syncUser);
      window.removeEventListener('storage', syncUser);
    };
  }, []);

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

  useEffect(() => {
    if (pathname.startsWith('/compete/news')) markNewsRead();
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    function syncUnread() {
      if (cancelled) return;
      setUnreadNews(hasUnreadNews(latestNewsAtRef.current || null));
    }
    void fetchPublicNews(1)
      .then((news) => {
        const latest = news[0];
        latestNewsAtRef.current = Number(latest?.publishedAt || latest?.createdAt || 0) || 0;
        syncUnread();
      })
      .catch(() => undefined);
    window.addEventListener(NEWS_READ_EVENT, syncUnread);
    return () => {
      cancelled = true;
      window.removeEventListener(NEWS_READ_EVENT, syncUnread);
    };
  }, []);

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
      label: t('header.play'),
      active: isHome,
    },
    {
      to: '/compete/live',
      icon: LIVE_ICON,
      label: t('header.live'),
      active: pathname.startsWith('/compete/live'),
    },
    {
      to: '/trade',
      icon: TRADE_ICON,
      label: t('header.trade'),
      active: pathname.startsWith('/trade'),
      onClick: (event) => {
        event.preventDefault();
        navigate('/trade');
      },
    },
    {
      to: '/compete/rank',
      icon: RANK_ICON,
      label: t('rating.navLabel'),
      active: pathname.startsWith('/compete/rank'),
    },
    {
      to: user ? `/compete/player/${user.id}` : '/compete#signup',
      icon: PROFILE_ICON,
      label: t('header.profile'),
      active: pathname.startsWith('/compete/player/') || pathname.startsWith('/compete/settings') || pathname.startsWith('/compete/payouts'),
    },
  ];

  const secondaryItems: NavItemDef[] = [
    {
      to: '/compete/news',
      icon: NEWS_ICON,
      label: t('header.news'),
      active: pathname.startsWith('/compete/news'),
      unread: unreadNews,
    },
    ...(user ? [{
      to: '/compete/journal',
      icon: JOURNAL_ICON,
      label: t('user.tradeJournal'),
      active: pathname.startsWith('/compete/journal'),
    }] : []),
    {
      to: '/compete/bonus',
      icon: BONUS_ICON,
      label: t('bonus.navLabel'),
      active: pathname.startsWith('/compete/bonus'),
    },
  ];

  if (isMobileWeb) return null;

  return (
    <header
      className="compete-header sticky top-0 z-50 border-b border-white/[0.07] bg-[#050507]/88 backdrop-blur-2xl"
      style={{ paddingTop: 'max(0px, env(safe-area-inset-top))' }}
    >
      <div className="relative z-10 mx-auto flex max-w-[1440px] items-center justify-between gap-2 px-4 py-2.5 md:px-8">
        <Link to="/compete" className="group flex shrink-0 items-center gap-2" title="BTF Arena">
          <img
            src="/assets/pictures/BTF_ARENA_logo.png"
            alt="BTF Arena"
            className="h-10 w-auto object-contain transition-transform duration-200 group-hover:scale-[1.03] sm:h-11"
          />
        </Link>

        {/* Navigation principale (desktop) */}
        <nav className="hidden items-center gap-1 lg:flex">
          {items.map((item) => (
            <NavItem key={item.to} item={item} />
          ))}
        </nav>

        {/* Menu compte desktop (un seul point d'entrée) */}
        <div className="hidden shrink-0 items-center gap-2 lg:flex">
          <Link
            to="/compete/news"
            className={`inline-flex items-center gap-1 px-3 py-2 font-['Barlow_Condensed',sans-serif] text-[11px] font-black italic uppercase tracking-[0.14em] transition-colors ${
              pathname.startsWith('/compete/news') ? 'text-white' : 'text-[#b8b8c2] hover:text-white'
            }`}
          >
            {t('header.news')}
            {unreadNews && <NewsBell />}
          </Link>
          <LanguageSwitcher />
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
                  className="absolute right-0 top-[calc(100%+8px)] z-50 w-64 overflow-hidden rounded-2xl border border-[#232329] bg-[#08080b] p-1.5 shadow-[0_24px_70px_-30px_rgba(0,0,0,0.95)]"
                >
                  <div className="border-b border-white/5 px-3 py-2">
                    <div className="micro text-[9px] text-[#71717a]">{t('header.account')}</div>
                    <div className="truncate text-sm font-semibold text-white">{user.name}</div>
                  </div>
                  <Link
                    to={`/compete/player/${user.id}`}
                    onClick={() => setMenuOpen(false)}
                    role="menuitem"
                    className="mt-1.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] text-[#b8b8c2] transition-colors hover:bg-[#dc2626]/10 hover:text-white"
                  >
                    {PROFILE_ICON}
                    {t('user.publicProfile')}
                  </Link>
                  <Link
                    to="/compete/news"
                    onClick={() => setMenuOpen(false)}
                    role="menuitem"
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] text-[#b8b8c2] transition-colors hover:bg-[#dc2626]/10 hover:text-white"
                  >
                    {NEWS_ICON}
                    {t('header.news')}
                    {unreadNews && <NewsBell />}
                  </Link>
                  <Link
                    to="/compete/journal"
                    onClick={() => setMenuOpen(false)}
                    role="menuitem"
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] text-[#b8b8c2] transition-colors hover:bg-[#dc2626]/10 hover:text-white"
                  >
                    {JOURNAL_ICON}
                    {t('user.tradeJournal')}
                  </Link>
                  <Link
                    to="/compete/bonus"
                    onClick={() => setMenuOpen(false)}
                    role="menuitem"
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] text-[#b8b8c2] transition-colors hover:bg-[#dc2626]/10 hover:text-white"
                  >
                    {BONUS_ICON}
                    {t('bonus.navLabel')}
                  </Link>
                  <div className="my-1.5 h-px bg-white/[0.06]" />
                  <Link
                    to="/compete/settings"
                    onClick={() => setMenuOpen(false)}
                    role="menuitem"
                    className="mt-1.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] text-[#b8b8c2] transition-colors hover:bg-[#dc2626]/10 hover:text-white"
                  >
                    {SETTINGS_ICON}
                    {t('header.settings')}
                  </Link>
                  <Link
                    to="/compete/payouts"
                    onClick={() => setMenuOpen(false)}
                    role="menuitem"
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] text-[#b8b8c2] transition-colors hover:bg-[#dc2626]/10 hover:text-white"
                  >
                    {PAYOUT_ICON}
                    {t('header.payouts')}
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
                <div className="mx-3 mb-0.5 mt-2 text-[9px] font-bold uppercase tracking-[0.18em] text-[#5f5f68]">
                  {t('header.discover')}
                </div>
                {secondaryItems.map((item) => (
                  <MobileNavItem key={item.to} item={item} onNavigate={() => setMobileOpen(false)} />
                ))}
              </nav>

              <div className="my-2 h-px bg-white/[0.06]" />

              <div className="flex items-center justify-between rounded-xl px-3 py-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#71717a]">{t('lang.label')}</span>
                <LanguageSwitcher />
              </div>

              <div className="my-2 h-px bg-white/[0.06]" />

              {user ? (
                <div className="flex flex-col gap-1">
                  <Link
                    to={`/compete/player/${user.id}`}
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center gap-3 rounded-xl px-3 py-3 text-xs font-bold uppercase tracking-[0.12em] text-[#b8b8c2] transition-colors hover:bg-[#dc2626]/10 hover:text-white"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.04] text-[#a5a5b0]">{PROFILE_ICON}</span>
                    {t('user.publicProfile')}
                  </Link>
                  <Link
                    to="/compete/settings"
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center gap-3 rounded-xl px-3 py-3 text-xs font-bold uppercase tracking-[0.12em] text-[#b8b8c2] transition-colors hover:bg-[#dc2626]/10 hover:text-white"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.04] text-[#a5a5b0]">{SETTINGS_ICON}</span>
                    {t('header.settings')}
                  </Link>
                  <Link
                    to="/compete/payouts"
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center gap-3 rounded-xl px-3 py-3 text-xs font-bold uppercase tracking-[0.12em] text-[#b8b8c2] transition-colors hover:bg-[#dc2626]/10 hover:text-white"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.04] text-[#a5a5b0]">{PAYOUT_ICON}</span>
                    {t('header.payouts')}
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
