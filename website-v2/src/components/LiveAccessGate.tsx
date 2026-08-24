import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

import {
  clearPaperSessionToken,
  extractPaperCompetitionContext,
  isCompetitionPaperSession,
  readPaperSessionToken,
  writePaperBootstrapCache,
  writePaperSessionToken,
} from '../lib/paperSession';

const TRADE_URL = '/trade?live=true';

/**
 * Page d'entrée du terminal Live (BTF event).
 *
 * Le code d'accès est le `traderCode` (6 caractères) généré par l'admin
 * dans /admin pour chaque joueur du roster.
 *
 * Sur succès :
 *   1. POST /api/paper/session { accessCode } → token + bootstrap complet
 *   2. localStorage `btf-paper-session-live` = token
 *   3. localStorage.btf-paper-bootstrap = snapshot consommé une seule fois
 *      par ExchangeTerminal au mount pour rendre l'UI sans round-trip /me.
 *   4. SPA navigation vers /trade?live=true (mode Live, pas compétition).
 */
export default function LiveAccessGate() {
  const navigate = useNavigate();
  const [accessCode, setAccessCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [checkingExisting, setCheckingExisting] = useState(true);

  // Si une session paper est déjà active dans le localStorage, on saute
  // directement vers le terminal — l'utilisateur n'a pas besoin de re-saisir
  // son code à chaque ouverture d'onglet.
  useEffect(() => {
    const liveToken = readPaperSessionToken('live');
    const competeToken = readPaperSessionToken('compete');
    // Une session ONLINE ne doit jamais ouvrir la porte LIVE.
    if (!liveToken || competeToken) {
      if (competeToken && liveToken) {
        clearPaperSessionToken('live');
      }
      setCheckingExisting(false);
      return;
    }
    fetch('/api/paper/me', {
      headers: { Authorization: `Bearer ${liveToken}` },
    })
      .then((response) => {
        if (!response.ok) {
          clearPaperSessionToken('live');
          setCheckingExisting(false);
          return null;
        }
        return response.json();
      })
      .then((data) => {
        if (!data?.player) {
          setCheckingExisting(false);
          return;
        }
        if (isCompetitionPaperSession(data)) {
          clearPaperSessionToken('live');
          const competition = extractPaperCompetitionContext(data);
          if (competition?.id) {
            writePaperSessionToken('compete', liveToken);
          }
          setCheckingExisting(false);
          return;
        }
        writePaperSessionToken('live', liveToken);
        navigate(TRADE_URL, { replace: true });
      })
      .catch(() => setCheckingExisting(false));
  }, [navigate]);

  async function login(event?: React.FormEvent) {
    event?.preventDefault();
    if (!accessCode.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/paper/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessCode: accessCode.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Connexion impossible');

      writePaperSessionToken('live', data.token);

      writePaperBootstrapCache({
        token: data.token,
        player: data.player,
        platform: 'live',
        competition: null,
        market: data.market || null,
        canTrade: typeof data.canTrade === 'boolean' ? data.canTrade : null,
      });

      navigate(TRADE_URL, { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  if (checkingExisting) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#020617] text-slate-400">
        <div className="text-sm">Chargement...</div>
      </div>
    );
  }

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-[#050507] text-slate-100">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-0">
        <div className="absolute inset-0 bg-[radial-gradient(70%_50%_at_50%_20%,rgba(220,38,38,0.18),transparent_60%)]" />
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[#050507] to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#050507] to-transparent" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center px-5 py-10">
        <div className="mb-8 flex flex-col items-center gap-3">
          <img
            src="/assets/pictures/logoBTF.webp"
            alt="BTF"
            className="h-16 w-16 rounded-2xl object-contain"
          />
          <div className="text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-red-400">
              BTF Live · Trader Access
            </p>
            <h1 className="mt-1 font-rajdhani text-3xl font-bold text-white">
              Terminal de l’événement
            </h1>
          </div>
        </div>

        <motion.form
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={login}
          className="w-full rounded-3xl border border-slate-800/80 bg-slate-900/70 p-6 shadow-2xl shadow-black/40 backdrop-blur sm:p-8"
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-red-400">
            Accès trader
          </p>
          <h2 className="mb-3 font-rajdhani text-2xl font-bold text-white">
            Connexion par code
          </h2>
          <p className="mb-6 text-sm text-slate-400">
            Saisis le code 6 caractères communiqué par l’admin pour rejoindre la room en direct.
          </p>

          <div className="space-y-4">
            <input
              type="text"
              value={accessCode}
              onChange={(event) => setAccessCode(event.target.value.toUpperCase())}
              placeholder="A7K9Q2"
              maxLength={12}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-4 text-center font-mono text-xl tracking-[0.4em] text-white outline-none transition-colors focus:border-red-500"
            />

            {error && (
              <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || !accessCode.trim()}
              className="w-full rounded-2xl bg-red-600 px-4 py-4 font-semibold uppercase tracking-wider text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-slate-700"
            >
              {submitting ? 'Connexion...' : 'Rejoindre la room'}
            </button>
          </div>
        </motion.form>
      </div>
    </div>
  );
}
