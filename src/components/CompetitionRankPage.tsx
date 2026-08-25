import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import CompeteHeader from './CompeteHeader';
import { useIsMobileWeb } from '../lib/mobileWeb';
import Seo from './Seo';
import { AvatarImage } from './OptimizedImage';
import { getBadgeVisual, type UserBadge } from './playerBadges';
import { formatDHMS } from '../utils/formatters';
import { countryFlag } from '../lib/country';
import {
  DIVISIONS,
  DIVISION_COLORS,
  DivisionBadge,
  RatingCard,
  divisionDisplayName,
  type PlayerRating,
  type RatingLeaderboardRow,
} from './playerRating';

const SESSION_KEY = 'btf-comp-session';

type SeasonRow = {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  country?: string | null;
  pnlUsd: number;
  arenas: number;
};

type SeasonSummary = {
  id: string;
  nameKey: string;
  theme: string;
  status: 'upcoming' | 'active' | 'ended';
  startAt?: number;
  endAt?: number;
  bannerImage?: string | null;
  championBadge?: UserBadge;
  shirtImage?: string | null;
  arenaImage?: string | null;
};

// Deux systèmes volontairement séparés :
// - classement de saison (PnL) : seul le n°1 est qualifié pour Paris ;
// - BTF Rating permanent : Bronze → Legend, sans qualification directe.
export default function CompetitionRankPage() {
  const { t, i18n } = useTranslation();
  const isMobileWeb = useIsMobileWeb();
  const [myRating, setMyRating] = useState<PlayerRating | null>(null);
  const [rows, setRows] = useState<RatingLeaderboardRow[]>([]);
  const [seasons, setSeasons] = useState<SeasonSummary[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState('');
  const [season, setSeason] = useState<SeasonSummary | null>(null);
  const [seasonRows, setSeasonRows] = useState<SeasonRow[]>([]);
  const [seasonLoading, setSeasonLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [visibleCount, setVisibleCount] = useState(20);
  const [seasonVisibleCount, setSeasonVisibleCount] = useState(10);
  const loadedSeasonIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const token = window.localStorage.getItem(SESSION_KEY);

    void (async () => {
      try {
        const [ratingResponse, bootstrapResponse, seasonsResponse, seasonBoardResponse] = await Promise.all([
          fetch('/api/competition/rating-leaderboard'),
          token
            ? fetch('/api/competition/bootstrap', { headers: { Authorization: `Bearer ${token}` } })
            : Promise.resolve(null),
          fetch('/api/competition/seasons'),
          fetch('/api/competition/global-leaderboard?season=summer-2026&fields=lite'),
        ]);
        if (cancelled) return;
        if (ratingResponse.ok) {
          const payload = await ratingResponse.json() as { rows?: RatingLeaderboardRow[] };
          if (!cancelled) setRows(Array.isArray(payload.rows) ? payload.rows : []);
        } else if (!cancelled) {
          // Endpoint absent sur l'API prod actuelle : le classement saison
          // reste affichable, seul le BTF Rating mondial est masqué.
          setError(t('rating.unavailable'));
        }
        if (bootstrapResponse?.ok) {
          const payload = await bootstrapResponse.json() as {
            myRating?: PlayerRating | null;
            user?: { id?: string } | null;
          };
          if (!cancelled) {
            setMyRating(payload.myRating ?? null);
            setCurrentUserId(payload.user?.id ? String(payload.user.id) : null);
          }
        }
        const seasonBoard = seasonBoardResponse.ok
          ? await seasonBoardResponse.json() as { season?: { id?: string }; rows?: SeasonRow[] }
          : null;
        if (seasonsResponse.ok) {
          const payload = await seasonsResponse.json() as {
            seasons?: SeasonSummary[];
            activeSeasonId?: string | null;
          };
          const seasons = Array.isArray(payload.seasons) ? payload.seasons : [];
          const selected = seasons.find((item) => item.id === payload.activeSeasonId)
            || seasons.find((item) => item.theme === 'summer' && item.status === 'active')
            || [...seasons].reverse().find((item) => item.theme === 'summer' && item.status !== 'upcoming')
            || null;
          if (!cancelled) setSeasons(seasons);
          if (selected) {
            if (!cancelled) {
              setSeason(selected);
              setSelectedSeasonId(selected.id);
            }
            if (seasonBoard && (seasonBoard.season?.id || 'summer-2026') === selected.id) {
              if (!cancelled) {
                setSeasonRows(Array.isArray(seasonBoard.rows) ? seasonBoard.rows : []);
                setSeasonLoading(false);
                loadedSeasonIdRef.current = selected.id;
              }
            }
          } else if (!cancelled) {
            setSeasonLoading(false);
          }
        } else if (!cancelled) {
          setSeasonLoading(false);
        }
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('common.unknownError'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    if (!selectedSeasonId) return;
    setSeason(seasons.find((item) => item.id === selectedSeasonId) || null);
    if (loadedSeasonIdRef.current === selectedSeasonId) return;
    let cancelled = false;
    setSeasonVisibleCount(10);
    setSeasonLoading(true);
    void fetch(`/api/competition/global-leaderboard?season=${encodeURIComponent(selectedSeasonId)}&fields=lite`)
      .then(async (response) => {
        if (!response.ok) throw new Error('unavailable');
        return response.json() as Promise<{ rows?: SeasonRow[] }>;
      })
      .then((payload) => {
        if (!cancelled) {
          setSeasonRows(Array.isArray(payload.rows) ? payload.rows : []);
          loadedSeasonIdRef.current = selectedSeasonId;
        }
      })
      .catch(() => {
        if (!cancelled) setSeasonRows([]);
      })
      .finally(() => {
        if (!cancelled) setSeasonLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [seasons, selectedSeasonId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="compete min-h-dvh-safe bg-[#050507]">
      <Seo title={t('rating.seoTitle')} description={t('rating.seoDesc')} path="/compete/rank" />
      <CompeteHeader />
      <div className="compete-bg" />

      <main className="relative mx-auto max-w-7xl px-6 pb-24 pt-8 md:px-10">
        {/* ——— PARIS MAJOR ——— */}
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="relative overflow-hidden rounded-3xl border border-[#dc2626]/40 bg-[#0a090c] shadow-[0_30px_80px_-40px_rgba(220,38,38,0.5)]"
        >
          <div className="relative h-40 w-full overflow-hidden sm:h-48 md:h-56">
            <video
              src={isMobileWeb ? '/assets/Videos/major-paris-mobile.mp4' : '/assets/Videos/major-paris-web.mp4'}
              className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center"
              autoPlay
              muted
              loop
              playsInline
              preload="none"
              poster="/assets/Seasons/summer-season-ranking.webp"
              disablePictureInPicture
              tabIndex={-1}
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#050507] via-[#050507]/25 to-transparent" />
            <div className="absolute bottom-4 left-5 md:bottom-5 md:left-6">
              <div className="micro text-[10px] tracking-[0.3em] text-[#fca5a5] md:text-[11px]">PARIS</div>
              <div className="display text-4xl font-black uppercase italic leading-none text-white drop-shadow-[0_0_30px_rgba(220,38,38,0.6)] md:text-5xl">
                MAJOR
              </div>
              <div className="micro mt-1 text-[10px] tracking-[0.25em] text-[#d4d4d8]">LIVE EVENT</div>
            </div>
          </div>
          <div className="grid gap-5 p-6 md:grid-cols-[1.2fr_1fr] md:p-8">
            <div>
              <div className="micro text-[10px] text-[#dc2626]">{t('rating.parisKicker')}</div>
              <h1 className="display mt-1 text-3xl font-black uppercase text-white md:text-4xl">{t('rating.parisTitle')}</h1>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-[#a1a1aa]">{t('rating.parisLead')}</p>
            </div>
            <ol className="grid content-center gap-2.5">
              {[t('rating.parisStepOne'), t('rating.parisStepTwo'), t('rating.parisStepThree')].map((step, index) => (
                <li
                  key={step}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-bold uppercase tracking-wide ${
                    index === 2
                      ? 'border-[#f5b300]/50 bg-gradient-to-r from-[#f5b300]/15 to-[#dc2626]/10 text-white'
                      : 'border-white/10 bg-white/[0.03] text-[#d4d4d8]'
                  }`}
                >
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-black ${
                      index === 2 ? 'bg-[#f5b300] text-black' : 'border border-[#dc2626]/50 text-[#fca5a5]'
                    }`}
                  >
                    {`0${index + 1}`}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        </motion.section>

        {/* ——— CLASSEMENT DE SAISON : SEULE QUALIFICATION POUR PARIS ——— */}
        <section id="season" className="mt-10 scroll-mt-24 overflow-hidden rounded-3xl border border-[#f5b300]/35 bg-gradient-to-br from-[#211706] via-[#0d0a07] to-[#09090c] shadow-[0_24px_70px_-45px_rgba(245,179,0,0.55)]">
          {seasons.length > 1 && (
            <div className="flex gap-2 overflow-x-auto border-b border-[#f5b300]/20 bg-black/25 px-4 py-3 sm:px-7">
              {[...seasons]
                .sort((a, b) => {
                  if (a.theme === 'summer' && b.theme !== 'summer') return -1;
                  if (b.theme === 'summer' && a.theme !== 'summer') return 1;
                  return (a.startAt ?? 0) - (b.startAt ?? 0);
                })
                .map((item) => {
                  const upcoming = item.status === 'upcoming';
                  const active = selectedSeasonId === item.id && !upcoming;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={upcoming}
                      onClick={() => { if (!upcoming) setSelectedSeasonId(item.id); }}
                      className={`shrink-0 rounded-full border px-4 py-2 text-[9px] font-black uppercase tracking-[0.13em] ${
                        upcoming
                          ? 'cursor-not-allowed border-white/[0.06] bg-white/[0.02] text-[#5a5560]'
                          : active
                            ? 'border-[#f5b300]/60 bg-[#f5b300]/15 text-[#ffe7a3]'
                            : 'border-white/10 bg-white/[0.03] text-[#77717a] hover:border-white/25 hover:text-white'
                      }`}
                    >
                      {t(item.nameKey)}
                      {upcoming && (
                        <span className="ml-2 font-bold normal-case tracking-normal text-[#6f6973]">
                          · {t('rating.seasonComing')}
                        </span>
                      )}
                    </button>
                  );
                })}
            </div>
          )}
          <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,1fr)]">
            <div className="relative overflow-hidden border-b border-[#f5b300]/20 bg-[#120d08] lg:min-h-[460px] lg:border-b-0 lg:border-r">
              <img
                src={encodeURI(season?.bannerImage || '/assets/Seasons/summer-season-ranking.webp')}
                alt=""
                fetchPriority="high"
                decoding="async"
                className="block aspect-[2/1] h-auto w-full object-cover object-center lg:absolute lg:inset-0 lg:h-full lg:aspect-auto"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#09090c]/70 via-transparent to-transparent" />
              {season?.endAt ? (
                <div className="absolute bottom-4 left-4">
                  <span className="micro inline-flex items-center gap-2 rounded-full border border-[#f5b300]/45 bg-black/55 px-3 py-1.5 text-[#f5b300]">
                    <b className="text-[9px] font-black uppercase tracking-[0.14em]">
                      {season.endAt > now ? t('rating.seasonEndsIn') : t('rating.seasonEnded')}
                    </b>
                    {season.endAt > now && (
                      <strong className="num text-[12px] font-black tabular-nums text-[#ffe7a3]">
                        {formatDHMS(season.endAt - now, i18n.language.startsWith('fr') ? 'j' : 'd')}
                      </strong>
                    )}
                  </span>
                </div>
              ) : null}
            </div>

            <div className="flex min-h-0 flex-col p-4 sm:p-5 lg:h-0 lg:min-h-full">
              <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="micro text-[10px] text-[#f5b300]">{t('rating.qualifyingKicker')}</div>
                  <h2 className="display mt-1 text-2xl font-black uppercase text-white md:text-3xl">
                    {season ? t(season.nameKey) : t('rating.currentSeason')}
                  </h2>
                </div>
                <span className="rounded-full border border-[#f5b300]/45 bg-[#f5b300]/12 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-[#f5b300]">
                  {t('rating.top1Paris')}
                </span>
              </div>

              {seasonLoading ? (
                <div className="py-8 text-center text-sm text-[#a1a1aa]">{t('common.loading')}</div>
              ) : seasonRows.length === 0 ? (
                <div className="py-8 text-center text-sm text-[#a1a1aa]">{t('rating.emptySeason')}</div>
              ) : (
                <div className={`mt-3 flex-1 space-y-2 pr-1 ${isMobileWeb ? '' : 'min-h-[20.5rem] overflow-y-auto'}`}>
                  {(isMobileWeb ? seasonRows.slice(0, seasonVisibleCount) : seasonRows).map((row, index) => {
                    const qualifies = index === 0;
                    const isMe = row.userId === currentUserId;
                    if (qualifies) {
                      return (
                        <Link
                          key={row.userId}
                          to={`/compete/player/${row.userId}`}
                          className="block overflow-hidden rounded-2xl border border-[#f5b300]/55 bg-gradient-to-br from-[#f5b300]/18 via-[#1a1204] to-black/40 p-3 shadow-[0_12px_40px_-20px_rgba(245,179,0,0.8)]"
                        >
                          <div className="flex items-center gap-3">
                            {row.avatarUrl ? (
                              <AvatarImage src={row.avatarUrl} alt="" className="h-12 w-12 rounded-full object-cover ring-2 ring-[#f5b300]" sizePx={48} />
                            ) : (
                              <span className="flex h-12 w-12 items-center justify-center rounded-full border border-[#f5b300]/50 bg-[#18181e] text-sm font-black uppercase text-[#f5b300]">
                                {row.name.slice(0, 2)}
                              </span>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="micro text-[9px] text-[#f5b300]">{t('rating.parisBound')}</div>
                              <strong className="display block truncate text-xl font-black uppercase italic text-white">
                                {row.name}{countryFlag(row.country) ? ` ${countryFlag(row.country)}` : ''}
                                {isMe && <small className="ml-2 text-[8px] not-italic uppercase tracking-wider text-[#ff7184]">{t('rating.you')}</small>}
                              </strong>
                              <p className="mt-0.5 text-[11px] font-bold text-[#ffe7a3]">{t('rating.parisBoundLead')}</p>
                            </div>
                            <div className="text-right">
                              <b className="display block text-2xl font-black italic text-[#f5b300]">#1</b>
                              <b className={`num block text-sm ${row.pnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {row.pnlUsd >= 0 ? '+' : ''}{row.pnlUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })} $
                              </b>
                            </div>
                          </div>
                        </Link>
                      );
                    }
                    return (
                      <Link
                        key={row.userId}
                        to={`/compete/player/${row.userId}`}
                        className={`grid grid-cols-[38px_38px_1fr_auto] items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors hover:border-white/25 ${
                          isMe
                            ? 'border-[#dc2626]/50 bg-[#dc2626]/10'
                            : 'border-white/[0.06] bg-black/20'
                        }`}
                      >
                        <strong className="display text-lg font-black italic text-[#71717a]">
                          #{index + 1}
                        </strong>
                        {row.avatarUrl ? (
                          <AvatarImage src={row.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" sizePx={36} />
                        ) : (
                          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-[#18181e] text-[10px] font-black uppercase text-white">
                            {row.name.slice(0, 2)}
                          </span>
                        )}
                        <span className="min-w-0 truncate text-sm font-bold text-white">
                          {row.name}{countryFlag(row.country) ? ` ${countryFlag(row.country)}` : ''}
                          {isMe && <small className="ml-2 text-[8px] uppercase tracking-wider text-[#ff7184]">{t('rating.you')}</small>}
                        </span>
                        <span className="text-right">
                          <b className={`num block text-sm ${row.pnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {row.pnlUsd >= 0 ? '+' : ''}{row.pnlUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })} $
                          </b>
                          <small className="text-[8px] font-black uppercase tracking-wider text-[#5f5f68]">
                            {row.arenas} {t('rating.arenasShort')}
                          </small>
                        </span>
                      </Link>
                    );
                  })}
                  {isMobileWeb && seasonVisibleCount < seasonRows.length && (
                    <button
                      type="button"
                      onClick={() => setSeasonVisibleCount((count) => count + 10)}
                      className="mt-2 w-full rounded-xl border border-[#f5b300]/25 bg-[#f5b300]/10 px-4 py-3 text-[11px] font-black uppercase tracking-[0.16em] text-[#f5b300] transition-colors hover:border-[#f5b300]/50 hover:bg-[#f5b300]/20"
                    >
                      {t('rating.loadMore')}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

        <div className="mt-3 overflow-hidden rounded-3xl border border-[#f5b300]/30 bg-gradient-to-br from-[#211706] via-[#0d0a07] to-[#09090c] p-3 sm:p-4">
          <div className="micro text-[10px] font-black uppercase tracking-[0.16em] text-[#f5b300]">
            {t('rating.seasonPrizesLabel')}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {[
              {
                src: season?.championBadge
                  ? getBadgeVisual(season.championBadge).src
                  : encodeURI('/assets/badges/summer-season-badge.webp'),
                label: t('rating.seasonPrizeBadge'),
              },
              {
                src: encodeURI(season?.shirtImage || '/assets/badges/summer-season-shirt.webp'),
                label: t('rating.seasonPrizeShirt'),
              },
              {
                src: encodeURI(season?.arenaImage || '/assets/pictures/arena3d.webp'),
                label: t('rating.seasonPrizeParis'),
              },
            ].map((prize, index) => (
              <article
                key={prize.label}
                className="group relative overflow-hidden rounded-2xl border border-[#f5b300]/15 bg-black/30 px-3 py-3 text-center"
              >
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(245,179,0,0.16),transparent_62%)]" />
                <motion.img
                  src={prize.src}
                  alt=""
                  draggable={false}
                  loading="lazy"
                  decoding="async"
                  className="relative z-10 mx-auto h-20 w-auto select-none object-contain sm:h-24"
                  style={{ filter: 'drop-shadow(0 0 22px rgba(245,179,0,0.45))' }}
                  animate={{ y: [0, -5, 0] }}
                  transition={{ duration: 3.2 + index * 0.2, repeat: Infinity, ease: 'easeInOut', delay: index * 0.35 }}
                />
                <strong className="relative z-10 mt-2 block text-[11px] font-black uppercase tracking-[0.08em] text-[#ffe7a3]">
                  {prize.label}
                </strong>
              </article>
            ))}
          </div>
        </div>

        {/* Séparation explicite : le Rating permanent n'est pas qualificatif. */}
        <section className="mt-12 rounded-2xl border border-[#dc2626]/25 bg-[#dc2626]/[0.05] px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="micro rounded-full border border-[#dc2626]/40 bg-[#dc2626]/10 px-2.5 py-1 text-[9px] text-[#ff7184]">
              {t('rating.permanentBadge')}
            </span>
            <strong className="display text-lg font-black uppercase text-white">{t('rating.permanentTitle')}</strong>
          </div>
          <p className="mt-2 text-sm text-[#a1a1aa]">{t('rating.permanentNotQualifying')}</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {[
              [t('rating.purposeProgressTitle'), t('rating.purposeProgressLead')],
              [t('rating.purposeIdentityTitle'), t('rating.purposeIdentityLead')],
              [t('rating.purposeWorldTitle'), t('rating.purposeWorldLead')],
            ].map(([title, lead], index) => (
              <article key={title} className="rounded-xl border border-white/[0.07] bg-black/20 px-4 py-3">
                <span className="micro text-[8px] text-[#ff7184]">0{index + 1}</span>
                <strong className="display mt-1 block text-sm font-black uppercase text-white">{title}</strong>
                <p className="mt-1 text-[11px] leading-relaxed text-[#77717a]">{lead}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ——— MON RATING ——— */}
        {myRating && (
          <section className="mt-10">
            <div className="border-b border-[#1a1a20] pb-4">
              <div className="micro text-[10px] text-[#dc2626]">{t('rating.kicker')}</div>
              <h2 className="display mt-1 text-2xl font-bold text-white md:text-3xl">{t('rating.myDivision')}</h2>
            </div>
            <div className="mt-6">
              <RatingCard rating={myRating} />
            </div>
          </section>
        )}

        {/* ——— LES DIVISIONS ——— */}
        <section className="mt-10">
          <div className="border-b border-[#1a1a20] pb-4">
            <div className="micro text-[10px] text-[#dc2626]">{t('rating.ladderKicker')}</div>
            <h2 className="display mt-1 text-2xl font-bold text-white md:text-3xl">{t('rating.ladderTitle')}</h2>
            <p className="mt-2 max-w-2xl text-sm text-[#71717a]">{t('rating.ladderLead')}</p>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-[#2a2a32] bg-[#0b0b10] p-5 text-center">
              <div className="display text-lg font-black uppercase leading-tight text-white md:text-xl">
                {t('rating.ladderIntro')}
              </div>
            </div>
            {DIVISIONS.map((division) => {
              const color = DIVISION_COLORS[division.id];
              const isMine = myRating?.division.id === division.id;
              return (
                <div
                  key={division.id}
                  className={`flex flex-col items-center gap-2 rounded-2xl border p-4 text-center ${isMine ? 'ring-1' : ''}`}
                  style={{
                    borderColor: isMine ? color : 'rgba(255,255,255,0.08)',
                    background: `radial-gradient(80% 60% at 50% 0%, ${color}12, transparent 70%), #0b0b10`,
                    ...(isMine ? { boxShadow: `0 0 24px ${color}33` } : null),
                  }}
                >
                  <DivisionBadge division={{ id: division.id, label: division.label, tier: 0 }} size={76} />
                  <div className="display text-sm font-black uppercase text-white">{division.label}</div>
                  <div className="num text-[10px] text-[#71717a]">
                    {Number.isFinite(division.ceiling)
                      ? `${division.floor} – ${division.ceiling} pts`
                      : `${division.floor}+ pts`}
                  </div>
                  {isMine && (
                    <span className="micro rounded-full px-2 py-0.5 text-[8px]" style={{ color, border: `1px solid ${color}66` }}>
                      {t('rating.you')}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* ——— CLASSEMENT MONDIAL ——— */}
        <section className="mt-10">
          <div className="border-b border-[#1a1a20] pb-4">
            <div>
              <div className="micro text-[10px] text-[#dc2626]">{t('rating.worldKicker')}</div>
              <h2 className="display mt-1 text-2xl font-bold text-white md:text-3xl">{t('rating.worldTitle')}</h2>
              <p className="mt-2 text-sm text-[#71717a]">{t('rating.worldLead')}</p>
            </div>
          </div>

          {loading ? (
            <div className="glass-card mt-6 p-10 text-center text-sm text-[#b8b8c2]">{t('common.loading')}</div>
          ) : error ? (
            <div className="glass-card mt-6 p-10 text-center text-sm text-[#f87171]">{error}</div>
          ) : rows.length === 0 ? (
            <div className="glass-card mt-6 p-10 text-center text-sm text-[#b8b8c2]">{t('rating.emptyWorld')}</div>
          ) : (
            <div className="mt-6 grid gap-1.5">
              {rows.slice(0, visibleCount).map((row) => {
                const color = DIVISION_COLORS[row.division.id] || '#cbd5e1';
                return (
                  <Link
                    key={row.userId}
                    to={`/compete/player/${row.userId}`}
                    className="grid grid-cols-[44px_44px_1fr_auto_auto] items-center gap-3 rounded-xl border border-white/[0.06] bg-[#0b0b10] px-4 py-2.5 transition-colors hover:border-white/20"
                  >
                    <span className={`display text-lg font-black italic ${row.rank <= 3 ? 'text-[#f5b300]' : 'text-[#71717a]'}`}>
                      #{row.rank}
                    </span>
                    {row.avatarUrl ? (
                      <AvatarImage src={row.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" sizePx={36} />
                    ) : (
                      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-[#18181e] text-[11px] font-black uppercase text-[#d4d4d8]">
                        {row.name.slice(0, 2)}
                      </span>
                    )}
                    <span className="truncate text-sm font-bold text-white">{row.name}{countryFlag(row.country) ? ` ${countryFlag(row.country)}` : ''}</span>
                    <span
                      className="micro hidden rounded-full px-2.5 py-1 text-[9px] sm:inline-flex"
                      style={{ color, border: `1px solid ${color}55`, background: `${color}14` }}
                    >
                      {divisionDisplayName(row.division)}
                    </span>
                    <span className="num text-sm font-bold" style={{ color }}>
                      {row.points} pts
                    </span>
                  </Link>
                );
              })}
              {visibleCount < rows.length && (
                <button
                  type="button"
                  onClick={() => setVisibleCount((count) => count + 20)}
                  className="mt-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[11px] font-black uppercase tracking-[0.16em] text-white transition-colors hover:border-[#dc2626]/50 hover:bg-[#dc2626]/10"
                >
                  {t('rating.loadMore')}
                </button>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
