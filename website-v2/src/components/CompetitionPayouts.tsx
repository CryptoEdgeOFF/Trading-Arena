import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { COMPETE_SESSION_KEY, readCachedCompeteUser, type CompeteSessionUser } from '../lib/competeSession';
import PayoutCertificate, { type PayoutCertificateHandle } from './PayoutCertificate';

type PayoutStatus = 'available' | 'pending' | 'approved';

interface MyPayout {
  id: string;
  amount: number;
  currency: string;
  paidAt: number;
  arenaTitle: string | null;
  rank?: number | null;
  status?: PayoutStatus;
  erc20Address?: string | null;
  requestedAt?: number | null;
  approvedAt?: number | null;
}

function rankLabel(rank?: number | null): string {
  const r = Number(rank);
  if (r === 1) return '#1';
  if (r === 2) return '#2';
  if (r === 3) return '#3';
  if (Number.isFinite(r) && r > 0) return `#${r}`;
  return '—';
}

function formatAmount(amount: number, currency: string): string {
  const cur = String(currency || 'USD').toUpperCase();
  const sym = cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : '$';
  return `${sym}${Number(amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function isValidErc20(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr.trim());
}

export default function CompetitionPayouts() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [token, setToken] = useState('');
  const [user, setUser] = useState<CompeteSessionUser | null>(null);
  const [payouts, setPayouts] = useState<MyPayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<Record<string, string>>({});
  const [viewPayout, setViewPayout] = useState<MyPayout | null>(null);
  const certRef = useRef<PayoutCertificateHandle>(null);

  const loadPayouts = useCallback(async (authToken: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/competition/my-payouts', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.status === 401) throw new Error(t('payoutPage.invalidSession'));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('common.unknownError'));
      setPayouts(data.payouts || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('common.unknownError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const stored = window.localStorage.getItem(COMPETE_SESSION_KEY);
    if (!stored) {
      navigate('/compete');
      return;
    }
    setToken(stored);
    setUser(readCachedCompeteUser());
    void loadPayouts(stored);
  }, [navigate, loadPayouts]);

  async function submitRequest(payout: MyPayout) {
    const addr = (addresses[payout.id] || '').trim();
    if (!isValidErc20(addr)) {
      setError(t('payoutPage.invalidAddress'));
      return;
    }
    setSubmittingId(payout.id);
    setError('');
    try {
      const res = await fetch(`/api/competition/payouts/${payout.id}/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ erc20Address: addr }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('common.unknownError'));
      await loadPayouts(token);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('common.unknownError'));
    } finally {
      setSubmittingId(null);
    }
  }

  function statusBadge(status?: PayoutStatus) {
    const s = status || 'available';
    if (s === 'pending') {
      return (
        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
          {t('payoutPage.statusPending')}
        </span>
      );
    }
    if (s === 'approved') {
      return (
        <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
          {t('payoutPage.statusApproved')}
        </span>
      );
    }
    return (
      <span className="rounded-full border border-[#dc2626]/40 bg-[#dc2626]/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#fca5a5]">
        {t('payoutPage.statusAvailable')}
      </span>
    );
  }

  return (
    <div className="compete min-h-dvh-safe bg-[#050507]">
      <header
        className="compete-header sticky top-0 z-40 border-b border-[#1a1a20] bg-[rgba(5,5,7,0.92)] backdrop-blur-xl"
        style={{ paddingTop: 'max(0px, env(safe-area-inset-top))' }}
      >
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-3 md:px-10 md:py-4">
          <Link to="/compete" className="ghost-cta px-3 py-2 text-xs uppercase tracking-[0.14em]">
            {t('payoutPage.backToArena')}
          </Link>
          <span className="micro text-[10px] text-[#dc2626]">{t('payoutPage.title')}</span>
        </div>
      </header>

      <main className="compete-bg px-5 pb-10 pt-6 md:px-10 md:pt-8">
        <div className="mx-auto max-w-4xl">
          <section className="glass-card overflow-hidden p-5 md:p-8">
            <div className="micro text-[10px] text-[#dc2626]">{t('payoutPage.eyebrow')}</div>
            <h1 className="display mt-2 text-3xl font-bold text-white md:text-5xl">{t('payoutPage.title')}</h1>
            <p className="mt-2 max-w-2xl text-sm text-[#a1a1aa]">{t('payoutPage.intro')}</p>

            {error && (
              <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            )}

            {loading ? (
              <p className="mt-8 text-sm text-[#71717a]">{t('common.loading')}</p>
            ) : payouts.length === 0 ? (
              <div className="mt-8 flex flex-col items-center gap-4 rounded-2xl border border-dashed border-[#232329] bg-black/20 px-6 py-12 text-center">
                <img src="/assets/Payouts/emptyPayout.png" alt="" className="h-24 w-24 opacity-40" />
                <p className="text-sm text-[#71717a]">{t('payoutPage.empty')}</p>
              </div>
            ) : (
              <div className="mt-8 space-y-4">
                {payouts.map((payout) => {
                  const status = payout.status || 'available';
                  return (
                    <article
                      key={payout.id}
                      className="rounded-2xl border border-[#232329] bg-black/25 p-4 md:p-5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-lg font-semibold text-white">
                            {payout.arenaTitle || t('payoutPage.unknownArena')}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[#a1a1aa]">
                            <span>{t('payoutPage.place', { rank: rankLabel(payout.rank) })}</span>
                            <span className="text-[#52525b]">·</span>
                            <span className="font-semibold text-[#34d399]">{formatAmount(payout.amount, payout.currency)}</span>
                          </div>
                        </div>
                        {statusBadge(status)}
                      </div>

                      {status === 'available' && (
                        <div className="mt-4 space-y-3 border-t border-white/5 pt-4">
                          <label className="block">
                            <span className="micro mb-1.5 block text-[10px] text-[#71717a]">{t('payoutPage.erc20Label')}</span>
                            <input
                              type="text"
                              value={addresses[payout.id] || ''}
                              onChange={(e) => setAddresses((prev) => ({ ...prev, [payout.id]: e.target.value }))}
                              placeholder="0x…"
                              spellCheck={false}
                              className="w-full rounded-xl border border-[#232329] bg-[#0c0c10] px-3 py-2.5 font-mono text-sm text-white outline-none ring-[#dc2626]/0 transition focus:border-[#dc2626]/50 focus:ring-2 focus:ring-[#dc2626]/20"
                            />
                          </label>
                          <p className="text-xs text-[#71717a]">{t('payoutPage.erc20Hint')}</p>
                          <button
                            type="button"
                            disabled={submittingId === payout.id}
                            onClick={() => void submitRequest(payout)}
                            className="blood-cta px-4 py-2.5 text-xs uppercase tracking-[0.14em] disabled:opacity-50"
                          >
                            {submittingId === payout.id ? t('common.loading') : t('payoutPage.requestBtn')}
                          </button>
                        </div>
                      )}

                      {status === 'pending' && (
                        <p className="mt-4 border-t border-white/5 pt-4 text-sm text-[#a1a1aa]">
                          {t('payoutPage.pendingMsg')}
                          {payout.erc20Address && (
                            <span className="mt-2 block font-mono text-xs text-[#71717a]">{payout.erc20Address}</span>
                          )}
                        </p>
                      )}

                      {status === 'approved' && (
                        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-white/5 pt-4">
                          <p className="text-sm text-emerald-300/90">{t('payoutPage.approvedMsg')}</p>
                          <button
                            type="button"
                            onClick={() => setViewPayout(payout)}
                            className="ghost-cta px-3 py-2 text-xs uppercase tracking-[0.12em]"
                          >
                            {t('payouts.viewCertificate')}
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </main>

      {viewPayout && user && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setViewPayout(null)}
          role="presentation"
        >
          <div
            className="relative max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl border border-[#232329] bg-[#0a0a0f] p-4"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <PayoutCertificate
              ref={certRef}
              data={{
                name: user.name,
                amount: viewPayout.amount,
                currency: viewPayout.currency,
                paidAt: viewPayout.paidAt,
              }}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setViewPayout(null)} className="ghost-cta px-3 py-2 text-xs uppercase">
                {t('common.close')}
              </button>
              <button
                type="button"
                onClick={() => certRef.current?.download()}
                className="blood-cta px-3 py-2 text-xs uppercase"
              >
                {t('payouts.download')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
