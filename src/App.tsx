import { useEffect } from 'react';
import { BrowserRouter, Navigate, Routes, Route, useLocation } from 'react-router-dom';
import ExchangeTerminal from './components/ExchangeTerminal';
import Dashboard from './components/Dashboard';
import LiveAccessGate from './components/LiveAccessGate';
import CompetitionPlatform from './components/CompetitionPlatform';
import CompetitionPublicLeaderboard from './components/CompetitionPublicLeaderboard';
import CompetitionSettings from './components/CompetitionSettings';
import CompetitionAdmin from './components/CompetitionAdmin';
import AdminPanel from './components/AdminPanel';
import FeedTest from './components/FeedTest';
import LegalFooter from './components/LegalFooter';
import { LegalPage } from './components/LegalPages';

const SCROLL_LOCK_PATTERN = /^\/(trade|trader|live-dashboard|btf-live-arena-2026|admin|feed-test)(\/|$)/;
const HIDE_FOOTER_PATTERN = /^\/(trade|trader|live-dashboard|btf-live-arena-2026|admin|feed-test|compete\/admin)(\/|$)/;

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

  return (
    <>
      <Routes>
        <Route path="/" element={<Navigate to="/compete" replace />} />
        <Route path="/admin" element={<AdminPanel />} />
        <Route path="/feed-test" element={<FeedTest />} />
        <Route path="/btf-live-arena-2026" element={<Dashboard />} />
        <Route path="/live-dashboard" element={<Dashboard />} />
        <Route path="/trader" element={<LiveAccessGate />} />
        <Route path="/trade" element={<TradeTerminalRoute />} />
        <Route path="/compete" element={<CompetitionPlatform />} />
        <Route path="/compete/settings" element={<CompetitionSettings />} />
        <Route path="/compete/admin" element={<CompetitionAdmin />} />
        <Route path="/compete/leaderboard/:id" element={<CompetitionPublicLeaderboard />} />
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
