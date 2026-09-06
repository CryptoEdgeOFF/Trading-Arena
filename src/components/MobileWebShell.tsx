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

function isImmersiveTrade(pathname: string, search: string): boolean {
  if (!pathname.startsWith('/trade')) return false;
  const params = new URLSearchParams(search);
  return params.get('live') === 'true' || Boolean(params.get('competitionId')?.trim());
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
  const { pathname, search } = useLocation();
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
  const isTradeTab = pathname.startsWith('/trade');
  const isTradeTerminal = isImmersiveTrade(pathname, search);
  const profileTo = user ? `/compete/player/${user.id}` : '/compete#signup';

  useEffect(() => {
    document.body.classList.add('mobile-web-active');
    const root = document.documentElement;
    let lastStable = 0;
    let blurTimer = 0;

    const isField = (el: Element | null) =>
      el instanceof HTMLElement && (
        el.tagName === 'INPUT'
        || el.tagName === 'TEXTAREA'
        || el.tagName === 'SELECT'
        || el.isContentEditable
      );

    const syncHeight = () => {
      const viewport = window.visualViewport;
      const visual = viewport?.height ?? window.innerHeight;
      if (!Number.isFinite(visual) || visual <= 0) return;
      const keyboard = isField(document.activeElement) && (
        (lastStable > 0 && visual < lastStable - 80)
        || window.innerHeight - visual > 120
        || (viewport?.offsetTop ?? 0) > 40
      );
      document.body.classList.toggle('mobile-web-keyboard', keyboard);
      if (keyboard) return;
      lastStable = Math.round(visual);
      root.style.setProperty('--mobile-web-height', `${lastStable}px`);
    };

    const onFocusIn = (event: FocusEvent) => {
      window.clearTimeout(blurTimer);
      syncHeight();
      const target = event.target;
      if (!(target instanceof HTMLElement) || !isField(target)) return;
      window.setTimeout(() => {
        target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      }, 280);
    };
    const onFocusOut = () => {
      window.clearTimeout(blurTimer);
      blurTimer = window.setTimeout(syncHeight, 80);
    };
    const onOrientation = () => {
      lastStable = 0;
      syncHeight();
    };

    syncHeight();
    const frame = window.requestAnimationFrame(syncHeight);
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', syncHeight);
    window.addEventListener('resize', syncHeight);
    window.addEventListener('orientationchange', onOrientation);
    window.addEventListener('pageshow', syncHeight);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.body.classList.remove('mobile-web-active');
      document.body.classList.remove('mobile-web-keyboard');
      root.style.removeProperty('--mobile-web-height');
      window.cancelAnimationFrame(frame);
      window.clearTimeout(blurTimer);
      viewport?.removeEventListener('resize', syncHeight);
      window.removeEventListener('resize', syncHeight);
      window.removeEventListener('orientationchange', onOrientation);
      window.removeEventListener('pageshow', syncHeight);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  const items: Array<{ id: NavId; to: string; label: string }> = [
    { id: 'home', to: '/compete', label: t('header.play') },
    { id: 'live', to: '/compete/live', label: t('header.live') },
    { id: 'trade', to: '/trade', label: t('header.trade') },
    { id: 'rank', to: '/compete/rank', label: t('rating.navLabel') },
    { id: 'profile', to: profileTo, label: t('header.profile') },
  ];

  return (
    <div className={`mobile-web-shell${isTradeTab ? ' is-trade' : ''}${isTradeTerminal ? ' is-immersive' : ''}`}>
      <div className="mobile-web-shell__ambient mobile-web-shell__ambient--one" />
      <div className="mobile-web-shell__ambient mobile-web-shell__ambient--two" />
      <div ref={screenRef} className={`mobile-web-shell__screen${isTradeTab ? ' is-trade' : ''}`}>
        {children}
      </div>
      {!isTradeTerminal && (
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
      )}
    </div>
  );
}
