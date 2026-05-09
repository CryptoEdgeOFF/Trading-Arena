import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom';
import ExchangeTerminal from './components/ExchangeTerminal';
import CompetitionPlatform from './components/CompetitionPlatform';
import CompetitionPublicLeaderboard from './components/CompetitionPublicLeaderboard';
import CompetitionSettings from './components/CompetitionSettings';
import LegalFooter from './components/LegalFooter';
import { LegalPage } from './components/LegalPages';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/compete" replace />} />
        <Route path="/trade" element={<ExchangeTerminal />} />
        <Route path="/compete" element={<CompetitionPlatform />} />
        <Route path="/compete/settings" element={<CompetitionSettings />} />
        <Route path="/compete/leaderboard/:id" element={<CompetitionPublicLeaderboard />} />
        <Route path="/cgu" element={<LegalPage type="cgu" />} />
        <Route path="/confidentialite" element={<LegalPage type="confidentialite" />} />
        <Route path="/mentions-legales" element={<LegalPage type="mentions" />} />
        <Route path="/risques" element={<LegalPage type="risques" />} />
        <Route path="*" element={<Navigate to="/compete" replace />} />
      </Routes>
      <LegalFooter />
    </BrowserRouter>
  );
}
