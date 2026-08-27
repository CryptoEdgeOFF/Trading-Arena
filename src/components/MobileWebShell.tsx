import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { COMPETE_SESSION_EVENT, readCachedCompeteUser } from '../lib/competeSession';
import './MobileWebShell.css';

type NavId = 'home' | 'live' | 'trade' | 'rank' | 'profile';

const ICONS: Record<NavId, ReactNode> = {
  home: <path d="M7 4.8v14.4a.5.5 0 0 0 .76.43l11.77-7.2a.5.5 0 0 0 0-.86L7.76 4.37A.5.5 0 0 0 7 4.8Z" />,
  live: <path d="M12 12h.01M8.5 8.5a5 5 0 0 0 0 7m7-7a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8m12.8-12.8a9 9 0 0 1 0 12.8" />,
  trade: <path d="M5 19V9m0 0L2.5 11.5M5 9l2.5 2.5M19 5v10m0 0 2.5-2.5M19 15l-2.5-2.5M10 7h4m-4 5h4m-4 5h4" />,
  rank: <path d="M8 21h8m-4-4v4M6 4h12v3a6 6 0 0 1-12 0V4Zm12 1h3a3 3 0 0 1-3 4M6 5H3a3 3 0 0 0 3 4" />,
  profile: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 9a7 7 0 0 0-14 0" />,
};

function NavIcon({ name }: { name: NavId }) {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

function activeTab(pathname: string): NavId | null {
  if (pathname.startsWith('/trade')) return 'trade';
  if (pathname.startsWith('/compete/live')) return 'live';
  if (pathname.startsWith('/compete/rank')) return 'rank';
  if (
    pathname.startsWith('/compete/player/')
    || pathname.startsWith('/compete/settings')
    || pathname.startsWith('/compete/payouts')
    || pathname.startsWith('/compete/journal')
  ) return 'profile';
  if (pathname === '/compete' || pathname === '/compete/') return 'home';
  return null;
}

export default function MobileWebShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [user, setUser] = useState(() => readCachedCompeteUser());
  const screenRef = useRef<HTMLDivElement | null>(null);
  const tab = activeTab(pathname);

  useEffect(() => {
    screenRef.current?.scrollTo(0, 0);
  }, [pathname]);

  useEffect(() => {
    const sync = () => setUser(readCachedCompeteUser());
    sync();
    window.addEventListener(COMPETE_SESSION_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(COMPETE_SESSION_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [pathname]);
  const isTrade = pathname.startsWith('/trade');
  const profileTo = user ? `/compete/player/${user.id}` : '/compete#signup';

  useEffect(() => {
    document.body.classList.add('mobile-web-active');
    return () => document.body.classList.remove('mobile-web-active');
  }, []);

  const items: Array<{ id: NavId; to: string; label: string }> = [
    { id: 'home', to: '/compete', label: t('header.play') },
    { id: 'live', to: '/compete/live', label: t('header.live') },
    { id: 'trade', to: '/trade', label: t('header.trade') },
    { id: 'rank', to: '/compete/rank', label: t('rating.navLabel') },
    { id: 'profile', to: profileTo, label: t('header.profile') },
  ];

  return (
    <div className="mobile-web-shell">
      <div className="mobile-web-shell__ambient mobile-web-shell__ambient--one" />
      <div className="mobile-web-shell__ambient mobile-web-shell__ambient--two" />
      <div ref={screenRef} className={`mobile-web-shell__screen${isTrade ? ' is-trade' : ''}`}>
        {children}
      </div>
      <nav className="mobile-web-nav" aria-label={t('header.play')}>
        {items.map((item) => (
          <Link
            key={item.id}
            to={item.to}
            className={`${tab === item.id ? 'is-active' : ''} ${item.id === 'trade' ? 'is-trade' : ''}`}
            aria-current={tab === item.id ? 'page' : undefined}
          >
            <span><NavIcon name={item.id} /></span>
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
