import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import CompeteHeader from './CompeteHeader';
import { AvatarImage } from './OptimizedImage';
import { BadgeCollection, NameBadges, type UserBadge } from './playerBadges';
import { formatCompactSigned } from './competeMetrics';
import PayoutCertificate, { type PayoutCertificateHandle } from './PayoutCertificate';

interface PlayerPayout {
  id: string;
  amount: number;
  currency: string;
  paidAt: number;
}

interface PlayerStats {
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number | null;
  avgRR: number | null;
  netPnl: number;
  totalFees: number;
}

interface PlayerArena {
  id: string;
  title: string;
  status: 'registration' | 'starting_soon' | 'live' | 'ended';
  startAt: number;
  endAt: number;
  participants: number;
  rank: number | null;
  pnlUsd: number;
  pnlPercent: number;
  tradesCount: number;
}

interface PlayerSocials {
  x?: string;
  instagram?: string;
  discord?: string;
  website?: string;
}

interface PlayerProfile {
  user: { id: string; name: string; avatarUrl: string | null; socials?: PlayerSocials };
  badges: UserBadge[];
  totalPnlUsd: number;
  arenas: PlayerArena[];
  payouts?: PlayerPayout[];
  stats: PlayerStats;
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/** Normalise un identifiant/URL social en lien cliquable (ou null si Discord/pseudo). */
function socialHref(kind: keyof PlayerSocials, value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (kind === 'discord') return null; // Discord = pseudo, pas de lien direct fiable.
  const handle = raw.replace(/^@/, '');
  if (kind === 'x') return `https://x.com/${handle}`;
  if (kind === 'instagram') return `https://instagram.com/${handle}`;
  if (kind === 'website') return `https://${raw}`;
  return null;
}

const SOCIAL_ICON: Record<keyof PlayerSocials, React.ReactNode> = {
  x: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  ),
  instagram: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <path d="M17.5 6.5h.01" />
    </svg>
  ),
  discord: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.369A19.79 19.79 0 0 0 16.558 3.2a.074.074 0 0 0-.079.037c-.34.6-.717 1.385-.98 2.001a18.27 18.27 0 0 0-5.487 0 12.6 12.6 0 0 0-.997-2.001.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C1.533 7.55.95 10.65 1.236 13.71a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.873-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127c-.598.349-1.22.645-1.873.892a.076.076 0 0 0-.04.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.029 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.056c.5-3.547-.838-6.624-3.549-9.314a.06.06 0 0 0-.031-.028ZM8.02 11.846c-1.182 0-2.157-1.086-2.157-2.42 0-1.333.956-2.42 2.157-2.42 1.21 0 2.176 1.096 2.157 2.42 0 1.334-.956 2.42-2.157 2.42Zm7.975 0c-1.183 0-2.157-1.086-2.157-2.42 0-1.333.955-2.42 2.157-2.42 1.21 0 2.176 1.096 2.157 2.42 0 1.334-.946 2.42-2.157 2.42Z" />
    </svg>
  ),
  website: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" />
    </svg>
  ),
};

function SocialLinks({ socials }: { socials?: PlayerSocials }) {
  if (!socials) return null;
  const order: Array<keyof PlayerSocials> = ['x', 'instagram', 'discord', 'website'];
  const entries = order
    .map((kind) => ({ kind, value: (socials[kind] || '').trim() }))
    .filter((item) => item.value.length > 0);
  if (entries.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
      {entries.map(({ kind, value }) => {
        const href = socialHref(kind, value);
        const className =
          'flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-[#a5a5b0] transition-colors hover:border-[#dc2626]/45 hover:text-white';
        if (href) {
          return (
            <a key={kind} href={href} target="_blank" rel="noopener noreferrer" className={className} title={value}>
              {SOCIAL_ICON[kind]}
            </a>
          );
        }
        // Discord (pseudo) : pas de lien, juste un badge avec le pseudo en tooltip.
        return (
          <span key={kind} className={`${className} cursor-default`} title={value}>
            {SOCIAL_ICON[kind]}
          </span>
        );
      })}
    </div>
  );
}

function fmtDate(time: number): string {
  return new Date(time).toLocaleDateString(i18n.resolvedLanguage === 'fr' ? 'fr-FR' : 'en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function StatTile({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'pos' | 'neg' | 'neutral' }) {
  const color = tone === 'pos' ? 'text-emerald-400' : tone === 'neg' ? 'text-rose-400' : 'text-white';
  return (
    <div className="rounded-xl border border-[#1a1a20] bg-[#0a0a0d] px-3 py-4 text-center">
      <div className={`num text-lg font-bold leading-none ${color}`}>{value}</div>
      <div className="mt-2 text-[9px] uppercase tracking-[0.14em] text-[#71717a]">{label}</div>
    </div>
  );
}

function PayoutViewerModal({
  payout,
  playerName,
  onClose,
}: {
  payout: PlayerPayout | null;
  playerName: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const certRef = useRef<PayoutCertificateHandle>(null);
  useEffect(() => {
    if (!payout) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [payout, onClose]);

  return createPortal(
    <AnimatePresence>
      {payout && (
        <motion.div
          className="compete fixed inset-0 z-[130] flex items-center justify-center bg-black/85 p-4 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
        >
          <motion.div
            className="relative w-full max-w-[520px]"
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              aria-label={t('common.close')}
              onClick={onClose}
              className="absolute -top-3 -right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-[#2a2a32] bg-[#0a0a0d] text-lg text-white shadow-lg transition-colors hover:bg-[#16161c]"
            >
              ×
            </button>
            <PayoutCertificate
              ref={certRef}
              data={{ name: playerName, amount: payout.amount, currency: payout.currency, paidAt: payout.paidAt }}
              className="overflow-hidden rounded-2xl border border-[#232329] shadow-[0_30px_90px_-30px_rgba(0,0,0,0.9)]"
            />
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => certRef.current?.download()}
                className="inline-flex items-center gap-2 rounded-full border border-[#ee4326]/40 bg-[#ee4326]/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.16em] text-[#ff8a6b] transition-colors hover:bg-[#ee4326]/20"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                {t('payouts.download')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export default function CompetitionPlayerProfile() {
  const { t } = useTranslation();
  const { userId } = useParams();
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [activePayout, setActivePayout] = useState<PlayerPayout | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setProfile(null);
    fetch(`/api/competition/player/${userId}`)
      .then(async (response) => {
        if (cancelled) return;
        if (!response.ok) {
          setNotFound(true);
          return;
        }
        const data = (await response.json()) as PlayerProfile;
        if (!cancelled) setProfile(data);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const stats = profile?.stats ?? null;
  const hasTrades = Boolean(stats && stats.closedTrades > 0);
  const pnlTone: 'pos' | 'neg' | 'neutral' = profile
    ? profile.totalPnlUsd > 0 ? 'pos' : profile.totalPnlUsd < 0 ? 'neg' : 'neutral'
    : 'neutral';

  return (
    <div className="compete min-h-dvh-safe bg-[#050507]">
      <div className="compete-bg min-h-dvh-safe">
        <CompeteHeader />

        <main className="mx-auto max-w-5xl px-5 py-10 md:px-8">
          {loading ? (
            <div className="mt-10 text-center text-sm text-[#71717a]">{t('playerProfile.loading')}</div>
          ) : notFound || !profile ? (
            <div className="mt-10 rounded-2xl border border-dashed border-[#232329] bg-[#0a0a0d] px-6 py-12 text-center text-sm text-[#71717a]">
              {t('playerProfile.notFound')}
            </div>
          ) : (
            <>
              <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                className="glass-card card-shine relative overflow-hidden p-6 md:p-8"
              >
                <div className="hero-scanline" />
                <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[#dc2626]/15 blur-3xl hero-glow" />
                <div className="relative flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left">
                  {profile.user.avatarUrl ? (
                    <AvatarImage
                      src={profile.user.avatarUrl}
                      alt={profile.user.name}
                      className="h-20 w-20 shrink-0 rounded-2xl object-cover shadow-[0_12px_32px_-10px_rgba(220,38,38,0.6)]"
                      sizePx={80}
                    />
                  ) : (
                    <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#dc2626] to-[#7f1d1d] text-2xl font-bold uppercase text-white shadow-[0_12px_32px_-10px_rgba(220,38,38,0.6)]">
                      {getInitials(profile.user.name)}
                    </span>
                  )}
                  <div className="min-w-0">
                    <div className="micro text-[10px] text-[#dc2626]">{t('playerProfile.eyebrow')}</div>
                    <h1 className="display mt-1 flex flex-wrap items-center justify-center gap-2 text-2xl font-bold text-white sm:justify-start md:text-3xl">
                      {profile.user.name}
                      <NameBadges badges={profile.badges} />
                    </h1>
                    <div className={`num mt-2 text-lg font-bold ${pnlTone === 'pos' ? 'text-emerald-400' : pnlTone === 'neg' ? 'text-rose-400' : 'text-white'}`}>
                      {formatCompactSigned(profile.totalPnlUsd)} $
                      <span className="ml-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#71717a]">{t('playerProfile.totalPnl')}</span>
                    </div>
                    <SocialLinks socials={profile.user.socials} />
                  </div>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
                className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
              >
                <StatTile
                  label={t('playerProfile.winRate')}
                  value={hasTrades ? `${(stats!.winRate * 100).toFixed(1)}%` : '—'}
                  tone={hasTrades ? (stats!.winRate >= 0.5 ? 'pos' : 'neg') : 'neutral'}
                />
                <StatTile
                  label={t('playerProfile.avgRR')}
                  value={stats?.avgRR != null ? stats.avgRR.toFixed(2) : '—'}
                  tone={stats?.avgRR != null ? (stats.avgRR >= 1 ? 'pos' : 'neg') : 'neutral'}
                />
                <StatTile
                  label={t('playerProfile.profitFactor')}
                  value={
                    !hasTrades
                      ? '—'
                      : stats!.profitFactor == null
                        ? stats!.wins > 0 ? '∞' : '—'
                        : stats!.profitFactor.toFixed(2)
                  }
                  tone={
                    !hasTrades
                      ? 'neutral'
                      : stats!.profitFactor == null
                        ? stats!.wins > 0 ? 'pos' : 'neutral'
                        : stats!.profitFactor >= 1 ? 'pos' : 'neg'
                  }
                />
                <StatTile label={t('playerProfile.wins')} value={stats ? String(stats.wins) : '—'} tone="pos" />
                <StatTile label={t('playerProfile.losses')} value={stats ? String(stats.losses) : '—'} tone="neg" />
                <StatTile label={t('playerProfile.arenas')} value={String(profile.arenas.length)} />
              </motion.div>

              <motion.section
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
                className="mt-8"
              >
                <div className="micro mb-3 text-[10px] text-[#71717a]">{t('badges.title')}</div>
                <BadgeCollection badges={profile.badges} />
              </motion.section>

              {profile.payouts && profile.payouts.length > 0 && (
                <motion.section
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
                  className="mt-8"
                >
                  <div className="micro mb-3 text-[10px] text-[#71717a]">{t('payouts.title')}</div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {profile.payouts.map((payout) => (
                      <button
                        key={payout.id}
                        type="button"
                        onClick={() => setActivePayout(payout)}
                        className="group relative overflow-hidden rounded-xl border border-[#1a1a20] bg-[#0a0a0d] transition-transform duration-200 hover:-translate-y-0.5 hover:border-[#3a2a28] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ee4326]/60"
                        aria-label={t('payouts.viewCertificate')}
                      >
                        <PayoutCertificate
                          data={{
                            name: profile.user.name,
                            amount: payout.amount,
                            currency: payout.currency,
                            paidAt: payout.paidAt,
                          }}
                        />
                        <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
                      </button>
                    ))}
                  </div>
                </motion.section>
              )}

              <motion.section
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
                className="mt-8"
              >
                <div className="micro mb-3 text-[10px] text-[#71717a]">{t('playerProfile.arenaHistory')}</div>
                {profile.arenas.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[#232329] bg-[#0a0a0d] px-6 py-10 text-center text-sm text-[#71717a]">
                    {t('playerProfile.noArenas')}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[620px] border-separate border-spacing-y-1.5">
                      <thead>
                        <tr className="text-left text-[10px] uppercase tracking-[0.16em] text-[#71717a]">
                          <th className="px-3 py-1.5 font-semibold">{t('playerProfile.arena')}</th>
                          <th className="px-3 py-1.5 font-semibold">{t('playerProfile.date')}</th>
                          <th className="px-3 py-1.5 font-semibold">{t('playerProfile.status')}</th>
                          <th className="px-3 py-1.5 text-right font-semibold">{t('playerProfile.rank')}</th>
                          <th className="px-3 py-1.5 text-right font-semibold">{t('playerProfile.trades')}</th>
                          <th className="px-3 py-1.5 text-right font-semibold">PnL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {profile.arenas.map((arena) => {
                          const pos = arena.pnlUsd >= 0;
                          const isPreLive = arena.status === 'registration' || arena.status === 'starting_soon';
                          const statusLabel = arena.status === 'live'
                            ? t('playerProfile.statusLive')
                            : arena.status === 'registration'
                              ? t('status.registration')
                              : arena.status === 'starting_soon'
                                ? t('status.startingSoon')
                                : t('playerProfile.statusEnded');
                          const statusColor = arena.status === 'live'
                            ? 'border-emerald-400/35 bg-emerald-400/10 text-emerald-300'
                            : isPreLive
                              ? 'border-sky-400/35 bg-sky-400/10 text-sky-300'
                              : 'border-[#2a2a32] bg-[#16161c] text-[#9a9aa6]';
                          const isWinner = arena.status === 'ended' && arena.rank === 1;
                          return (
                            <tr key={arena.id} className="bg-[#0c0c10] transition-colors hover:bg-[#101016]">
                              <td className="max-w-[220px] truncate rounded-l-lg border-y border-l border-[#1a1a20] px-3 py-2.5 text-xs font-semibold text-white">
                                <Link to={`/compete/leaderboard/${arena.id}`} className="underline-offset-2 hover:underline">
                                  {arena.title}
                                </Link>
                              </td>
                              <td className="num border-y border-[#1a1a20] px-3 py-2.5 text-xs text-[#9a9aa6]">
                                {fmtDate(arena.startAt)}
                              </td>
                              <td className="border-y border-[#1a1a20] px-3 py-2.5">
                                <span className={`rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] ${statusColor}`}>
                                  {statusLabel}
                                </span>
                              </td>
                              <td className="num border-y border-[#1a1a20] px-3 py-2.5 text-right text-xs">
                                {arena.rank == null ? (
                                  <span className="text-[#52525b]">—</span>
                                ) : (
                                  <span className={isWinner ? 'font-bold text-amber-300' : 'text-[#e0e2ea]'}>
                                    {isWinner ? '🏆 ' : ''}#{arena.rank}
                                    <span className="text-[#52525b]"> / {arena.participants}</span>
                                  </span>
                                )}
                              </td>
                              <td className="num border-y border-[#1a1a20] px-3 py-2.5 text-right text-xs text-[#9a9aa6]">
                                {arena.tradesCount}
                              </td>
                              <td className={`num rounded-r-lg border-y border-r border-[#1a1a20] px-3 py-2.5 text-right text-sm font-bold ${pos ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {formatCompactSigned(arena.pnlUsd)} $
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </motion.section>
            </>
          )}
        </main>
      </div>
      <PayoutViewerModal
        payout={activePayout}
        playerName={profile?.user.name || ''}
        onClose={() => setActivePayout(null)}
      />
    </div>
  );
}
