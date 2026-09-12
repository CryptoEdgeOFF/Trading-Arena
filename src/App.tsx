import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Outlet, Routes, Route, useLocation } from 'react-router-dom';
import { MobileWebProvider, useIsMobileWeb } from './lib/mobileWeb';
import MobileWebShell from './components/MobileWebShell';
import LegalFooter from './components/LegalFooter';
import { LegalPage } from './components/LegalPages';
import { ADMIN_ENABLED, ADMIN_PATH, ADMIN_PATH_REGEX, TERMINAL_REVIEW_PATH } from './lib/adminPath';
import { trackPageView } from './lib/analytics';

const ExchangeTerminal = lazy(() => import('./components/ExchangeTerminal'));
const ExchangeTerminalRedesign = lazy(() => import('./components/ExchangeTerminalRedesign'));
const DemoTradingPage = lazy(() => import('./components/DemoTradingPage'));
const PlayerTerminalReview = lazy(() => import('./components/PlayerTerminalReview'));
const Dashboard = lazy(() => import('./components/Dashboard'));
const LiveAccessGate = lazy(() => import('./components/LiveAccessGate'));
const CompetitionPlatform = lazy(() => import('./components/CompetitionPlatform'));
const CompetitionLivePage = lazy(() => import('./components/CompetitionLivePage'));
const CompetitionPublicLeaderboard = lazy(() => import('./components/CompetitionPublicLeaderboard'));
const TradeLiveBonus = lazy(() => import('./components/TradeLiveBonus'));
const CompetitionTradeJournal = lazy(() => import('./components/CompetitionTradeJournal'));
const CompetitionPlayerProfile = lazy(() => import('./components/CompetitionPlayerProfile'));
const CompetitionRankPage = lazy(() => import('./components/CompetitionRankPage'));
const CompetitionNewsPage = lazy(() => import('./components/CompetitionNewsPage'));
const CompetitionSettings = lazy(() => import('./components/CompetitionSettings'));
const CompetitionPayouts = lazy(() => import('./components/CompetitionPayouts'));
const CompetitionAdmin = lazy(() => import('./components/CompetitionAdmin'));
const PromotionsAdmin = lazy(() => import('./components/PromotionsAdmin'));
const NewsAdmin = lazy(() => import('./components/NewsAdmin'));
const PayoutsAdmin = lazy(() => import('./components/PayoutsAdmin'));
const PayoutRequestsAdmin = lazy(() => import('./components/PayoutRequestsAdmin'));
const EmailAdminPage = lazy(() => import('./components/EmailAdminPage'));
const AdminPanel = lazy(() => import('./components/AdminPanel'));
const ReplayViewer = lazy(() => import('./components/ReplayViewer'));
const ReplayLeaderboardPreview = lazy(() => import('./components/ReplayLeaderboardPreview'));
const FeedTest = lazy(() => import('./components/FeedTest'));

function RouteFallback() {
  return <div className="min-h-dvh bg-[#07060b]" aria-hidden />;
}

const ADMIN_SEG = ADMIN_PATH_REGEX ? `|${ADMIN_PATH_REGEX}` : '';
const SCROLL_LOCK_PATTERN = new RegExp(`^/(trade|trade-v2|trade-demo|trade-review|trader|live-dashboard|btf-live-arena-2026|feed-test|replay-lb-preview${ADMIN_SEG})(/|$)`);
const HIDE_FOOTER_PATTERN = new RegExp(`^/(trade|trade-v2|trade-demo|trade-review|trader|live-dashboard|btf-live-arena-2026|feed-test|replay-lb-preview${ADMIN_SEG})(/|$)`);

function TradeTerminalRoute() {
  const location = useLocation();
  return <ExchangeTerminal key={location.search} />;
}

function TradeTerminalRedesignRoute() {
  const location = useLocation();
  return <ExchangeTerminalRedesign key={location.search} />;
}

function CompeteAppChrome() {
  const isMobile = useIsMobileWeb();
  if (!isMobile) return <Outlet />;
  return (
    <MobileWebShell>
      <Outlet />
    </MobileWebShell>
  );
}

function AppRoutes() {
  const location = useLocation();
  const isMobile = useIsMobileWeb();
  const lockScroll = SCROLL_LOCK_PATTERN.test(location.pathname);
  const hideFooter = HIDE_FOOTER_PATTERN.test(location.pathname)
    || (isMobile && (location.pathname.startsWith('/compete') || location.pathname === '/trade'));

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

  // Suivi GA4 des pages vues (SPA). On masque le chemin admin secret pour ne
  // pas l'exposer dans les données analytics.
  useEffect(() => {
    const onAdmin = ADMIN_ENABLED && location.pathname.startsWith(`/${ADMIN_PATH}`);
    const path = onAdmin ? '/admin' : location.pathname;
    trackPageView(path);
  }, [location.pathname]);

  // Remet le scroll en haut à chaque changement de route (sinon on conserve la
  // position de la page précédente). On laisse les ancres « #section » gérer
  // leur propre défilement.
  useEffect(() => {
    if (location.hash) return;
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <>
      <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Navigate to="/compete" replace />} />
        {ADMIN_ENABLED && <Route path={`/${ADMIN_PATH}`} element={<AdminPanel />} />}
        {ADMIN_ENABLED && <Route path={`/${ADMIN_PATH}/arenes`} element={<CompetitionAdmin />} />}
        {ADMIN_ENABLED && <Route path={`/${ADMIN_PATH}/promotions`} element={<PromotionsAdmin />} />}
        {ADMIN_ENABLED && <Route path={`/${ADMIN_PATH}/news`} element={<NewsAdmin />} />}
        {ADMIN_ENABLED && <Route path={`/${ADMIN_PATH}/payouts`} element={<PayoutsAdmin />} />}
        {ADMIN_ENABLED && <Route path={`/${ADMIN_PATH}/payout-requests`} element={<PayoutRequestsAdmin />} />}
        {ADMIN_ENABLED && <Route path={`/${ADMIN_PATH}/emails`} element={<EmailAdminPage />} />}
        {ADMIN_ENABLED && <Route path={`/${ADMIN_PATH}/replay`} element={<ReplayViewer />} />}
        {ADMIN_ENABLED && <Route path={`/${ADMIN_PATH}/replay-standings`} element={<ReplayViewer standingsOnly />} />}
        {ADMIN_ENABLED && <Route path={TERMINAL_REVIEW_PATH} element={<PlayerTerminalReview />} />}
        <Route path="/trade-review" element={<PlayerTerminalReview />} />
        <Route path="/feed-test" element={<FeedTest />} />
        {import.meta.env.DEV && <Route path="/replay-lb-preview" element={<ReplayLeaderboardPreview />} />}
        <Route path="/btf-live-arena-2026" element={<Dashboard />} />
        <Route path="/live-dashboard" element={<Dashboard />} />
        <Route path="/trader" element={<LiveAccessGate />} />
        <Route element={<CompeteAppChrome />}>
          <Route path="/trade" element={<TradeTerminalRoute />} />
          <Route path="/compete" element={<CompetitionPlatform />} />
          <Route path="/compete/live" element={<CompetitionLivePage />} />
          <Route path="/compete/rank" element={<CompetitionRankPage />} />
          <Route path="/compete/settings" element={<CompetitionSettings />} />
          <Route path="/compete/payouts" element={<CompetitionPayouts />} />
          <Route path="/compete/leaderboard/:id" element={<CompetitionPublicLeaderboard />} />
          <Route path="/compete/global-leaderboard" element={<Navigate to="/compete/rank#season" replace />} />
          <Route path="/compete/bonus" element={<TradeLiveBonus />} />
          <Route path="/compete/news" element={<CompetitionNewsPage />} />
          <Route path="/compete/news/:id" element={<CompetitionNewsPage />} />
          <Route path="/compete/journal" element={<CompetitionTradeJournal />} />
          <Route path="/compete/player/:userId" element={<CompetitionPlayerProfile />} />
        </Route>
        <Route path="/trade-v2" element={<TradeTerminalRedesignRoute />} />
        <Route path="/trade-demo" element={<DemoTradingPage />} />
        <Route path="/cgu" element={<LegalPage type="cgu" />} />
        <Route path="/confidentialite" element={<LegalPage type="confidentialite" />} />
        <Route path="/mentions-legales" element={<LegalPage type="mentions" />} />
        <Route path="/risques" element={<LegalPage type="risques" />} />
        <Route path="/reglement" element={<LegalPage type="reglement" />} />
        <Route path="/supprimer-compte" element={<LegalPage type="deleteAccount" />} />
        <Route path="/delete-account" element={<LegalPage type="deleteAccount" />} />
        <Route path="*" element={<Navigate to="/compete" replace />} />
      </Routes>
      </Suspense>
      {!hideFooter && <LegalFooter />}
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <MobileWebProvider>
        <AppRoutes />
      </MobileWebProvider>
    </BrowserRouter>
  );
}
