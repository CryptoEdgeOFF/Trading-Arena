import { useEffect } from 'react';
import { BrowserRouter, Navigate, Routes, Route, useLocation } from 'react-router-dom';
import ExchangeTerminal from './components/ExchangeTerminal';
import Dashboard from './components/Dashboard';
import LiveAccessGate from './components/LiveAccessGate';
import CompetitionPlatform from './components/CompetitionPlatform';
import CompetitionPublicLeaderboard from './components/CompetitionPublicLeaderboard';
import CompetitionGlobalLeaderboard from './components/CompetitionGlobalLeaderboard';
import TradeLiveBonus from './components/TradeLiveBonus';
import CompetitionTradeJournal from './components/CompetitionTradeJournal';
import CompetitionPlayerProfile from './components/CompetitionPlayerProfile';
import CompetitionSettings from './components/CompetitionSettings';
import CompetitionAdmin from './components/CompetitionAdmin';
import PromotionsAdmin from './components/PromotionsAdmin';
import AdminPanel from './components/AdminPanel';
import ReplayViewer from './components/ReplayViewer';
import FeedTest from './components/FeedTest';
import LegalFooter from './components/LegalFooter';
import { LegalPage } from './components/LegalPages';
import { ADMIN_ENABLED, ADMIN_PATH, ADMIN_PATH_REGEX } from './lib/adminPath';

const ADMIN_SEG = ADMIN_PATH_REGEX ? `|${ADMIN_PATH_REGEX}` : '';
const SCROLL_LOCK_PATTERN = new RegExp(`^/(trade|trader|live-dashboard|btf-live-arena-2026|feed-test${ADMIN_SEG})(/|$)`);
const HIDE_FOOTER_PATTERN = new RegExp(`^/(trade|trader|live-dashboard|btf-live-arena-2026|feed-test${ADMIN_SEG})(/|$)`);

function TradeTerminalRoute() {
  const location = useLocation();
  return <ExchangeTerminal key={location.search} />;
}

function AppRoutes() {
  const location = useLocation();
  const lockScroll = SCROLL_LOCK_PATTERN.test(location.pathname);
  const hideFooter = HIDE_FOOTER_PATTERN.test(location.pathname);

  useEffect(() => {
    document.body.classList.toggle('app-scroll-lock', lockScroll);
    return () => document.body.classList.remove('app-scroll-lock');
  }, [lockScroll]);

  // noindex uniquement sur les pages admin (jamais via robots.txt public, qui
  // divulguerait le chemin secret).
  useEffect(() => {
    const onAdmin = ADMIN_ENABLED && location.pathname.startsWith(`/${ADMIN_PATH}`);
    let meta = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (onAdmin) {
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', 'robots');
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', 'noindex, nofollow');
    } else if (meta && meta.getAttribute('content')?.includes('noindex')) {
      meta.remove();
    }
  }, [location.pathname]);

  return (
    <>
      <Routes>
        <Route path="/" element={<Navigate to="/compete" replace />} />
        {ADMIN_ENABLED && <Route path={`/${ADMIN_PATH}`} element={<AdminPanel />} />}
        {ADMIN_ENABLED && <Route path={`/${ADMIN_PATH}/arenes`} element={<CompetitionAdmin />} />}
        {ADMIN_ENABLED && <Route path={`/${ADMIN_PATH}/promotions`} element={<PromotionsAdmin />} />}
        {ADMIN_ENABLED && <Route path={`/${ADMIN_PATH}/replay`} element={<ReplayViewer />} />}
        <Route path="/feed-test" element={<FeedTest />} />
        <Route path="/btf-live-arena-2026" element={<Dashboard />} />
        <Route path="/live-dashboard" element={<Dashboard />} />
        <Route path="/trader" element={<LiveAccessGate />} />
        <Route path="/trade" element={<TradeTerminalRoute />} />
        <Route path="/compete" element={<CompetitionPlatform />} />
        <Route path="/compete/settings" element={<CompetitionSettings />} />
        <Route path="/compete/leaderboard/:id" element={<CompetitionPublicLeaderboard />} />
        <Route path="/compete/global-leaderboard" element={<CompetitionGlobalLeaderboard />} />
        <Route path="/compete/bonus" element={<TradeLiveBonus />} />
        <Route path="/compete/journal" element={<CompetitionTradeJournal />} />
        <Route path="/compete/player/:userId" element={<CompetitionPlayerProfile />} />
        <Route path="/cgu" element={<LegalPage type="cgu" />} />
        <Route path="/confidentialite" element={<LegalPage type="confidentialite" />} />
        <Route path="/mentions-legales" element={<LegalPage type="mentions" />} />
        <Route path="/risques" element={<LegalPage type="risques" />} />
        <Route path="*" element={<Navigate to="/compete" replace />} />
      </Routes>
      {!hideFooter && <LegalFooter />}
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
