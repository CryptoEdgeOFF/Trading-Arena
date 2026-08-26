import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
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
  const location = useLocation();
  const navigate = useNavigate();
  const pane = location.hash === '#rating' ? 'rating' : 'season';
  const showSeason = pane === 'season';
  const showRating = pane === 'rating';
  const seasonPageSize = isMobileWeb ? 10 : 20;

  const setPane = (next: 'season' | 'rating') => {
    navigate({ pathname: '/compete/rank', hash: next }, { replace: true });
  };
  const [myRating, setMyRating] = useState<PlayerRating | null>(null);
  const [rows, setRows] = useState<RatingLeaderboardRow[]>([]);
  const [seasons, setSeasons] = useState<SeasonSummary[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState('');
  const [season, setSeason] = useState<SeasonSummary | null>(null);
  const [seasonRows, setSeasonRows] = useState<SeasonRow[]>([]);
  const [seasonLoading, setSeasonLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [meProfile, setMeProfile] = useState<{ name: string; avatarUrl?: string | null; country?: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [visibleCount, setVisibleCount] = useState(20);
  const [seasonVisibleCount, setSeasonVisibleCount] = useState(() => (window.matchMedia('(max-width: 767px)').matches ? 10 : 20));
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
            user?: { id?: string; name?: string; avatarUrl?: string | null; country?: string | null } | null;
          };
          if (!cancelled) {
            setMyRating(payload.myRating ?? null);
            setCurrentUserId(payload.user?.id ? String(payload.user.id) : null);
            if (payload.user?.id) {
              setMeProfile({
                name: payload.user.name || 'Trader BTF',
                avatarUrl: payload.user.avatarUrl ?? null,
                country: payload.user.country ?? null,
              });
            }
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
    setSeasonVisibleCount(seasonPageSize);
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
  }, [seasons, selectedSeasonId, seasonPageSize]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [pane]);

  const mySeasonIndex = seasonRows.findIndex((row) => row.userId === currentUserId);
  const mySeasonRow = mySeasonIndex >= 0 ? seasonRows[mySeasonIndex] : null;
  const myWorldRow = rows.find((row) => row.userId === currentUserId)
    || (currentUserId && myRating && meProfile
      ? {
          rank: myRating.worldRank || rows.length + 1,
          userId: currentUserId,
          name: meProfile.name,
          avatarUrl: meProfile.avatarUrl,
          country: meProfile.country,
          points: myRating.points,
          division: myRating.division,
        }
      : null);

  return (
    <div className="compete min-h-dvh-safe bg-[#050507]">
      <Seo title={t('rating.seoTitle')} description={t('rating.seoDesc')} path="/compete/rank" />
      <CompeteHeader />
      <div className="compete-bg" />

      <main className={`relative mx-auto ${isMobileWeb ? 'max-w-7xl px-4 pb-16 pt-3' : 'max-w-5xl px-6 pb-24 pt-6 md:px-8'}`}>
        <div className={`sticky z-20 ${isMobileWeb ? 'top-0 -mx-4 mb-3 border-b border-white/10 bg-[#050507]/95 px-4 py-2' : 'top-16 -mx-6 mb-5 border-b border-white/10 bg-[#050507]/92 px-6 py-3 md:-mx-8 md:px-8'} backdrop-blur`}>
          <div className={`grid grid-cols-2 gap-1 rounded-xl bg-white/[0.05] ${isMobileWeb ? 'p-1' : 'mx-auto max-w-xl p-1.5'}`}>
            {([
              ['season', t('rating.tabSeason')],
              ['rating', t('rating.tabRating')],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setPane(id)}
                className={`rounded-lg px-3 font-black uppercase tracking-[0.14em] ${
                  isMobileWeb ? 'py-2 text-[11px]' : 'py-2.5 text-[12px]'
                } ${pane === id ? 'bg-white text-black' : 'text-[#9a96a0] hover:text-white'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className={`mt-2 text-center text-[#8b8490] ${isMobileWeb ? 'text-[11px]' : 'text-[13px]'}`}>
            {t('rating.tabHint')}
          </p>
        </div>

        {/* ——— PARIS MAJOR ——— */}
        {showSeason && (
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className={`relative overflow-hidden rounded-3xl border border-[#dc2626]/40 bg-[#0a090c] shadow-[0_30px_80px_-40px_rgba(220,38,38,0.5)] ${isMobileWeb ? '' : 'grid grid-cols-[1.2fr_0.9fr]'}`}
        >
          <div className={`relative overflow-hidden ${isMobileWeb ? 'h-32' : 'min-h-[22rem]'}`}>
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
            <div className={`absolute left-5 ${isMobileWeb ? 'bottom-3' : 'bottom-6 left-6'}`}>
              <div className="micro text-[10px] tracking-[0.3em] text-[#fca5a5] md:text-[11px]">PARIS</div>
              <div className={`display font-black uppercase italic leading-none text-white drop-shadow-[0_0_30px_rgba(220,38,38,0.6)] ${isMobileWeb ? 'text-3xl' : 'text-5xl'}`}>
                MAJOR
              </div>
            </div>
          </div>
          <div className={isMobileWeb ? 'px-4 py-3' : 'flex flex-col justify-center gap-5 border-l border-white/5 px-7 py-7'}>
            <p className={`leading-snug text-[#c4c4cc] ${isMobileWeb ? 'text-[13px]' : 'text-[16px]'}`}>{t('rating.parisLeadMobile')}</p>
            <div className={isMobileWeb ? 'mt-2.5 flex flex-wrap gap-1.5' : 'grid gap-2.5'}>
              {[t('rating.parisStepOne'), t('rating.parisStepTwo'), t('rating.parisStepThree')].map((step, index) => (
                <span
                  key={step}
                  className={`rounded-full border font-black uppercase tracking-[0.08em] ${
                    isMobileWeb
                      ? 'px-2.5 py-1 text-[9px]'
                      : 'flex items-center gap-3 rounded-xl px-4 py-3 text-[12px]'
                  } ${
                    index === 2
                      ? 'border-[#f5b300]/50 bg-[#f5b300]/15 text-[#ffe7a3]'
                      : 'border-white/10 bg-white/[0.03] text-[#9a96a0]'
                  }`}
                >
                  {isMobileWeb ? `${index + 1}. ${step}` : (
                    <>
                      <b className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] ${
                        index === 2 ? 'bg-[#f5b300] text-black' : 'border border-white/15'
                      }`}>{index + 1}</b>
                      {step}
                    </>
                  )}
                </span>
              ))}
            </div>
          </div>
        </motion.section>
        )}

        {/* ——— CLASSEMENT DE SAISON : SEULE QUALIFICATION POUR PARIS ——— */}
        {showSeason && (
        <section id="season" className={`${isMobileWeb ? 'mt-4' : 'mt-5'} scroll-mt-24 overflow-hidden rounded-3xl border border-[#f5b300]/35 bg-gradient-to-br from-[#211706] via-[#0d0a07] to-[#09090c] shadow-[0_24px_70px_-45px_rgba(245,179,0,0.55)]`}>
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
          <div>
          <div className="relative overflow-hidden border-b border-[#f5b300]/20 bg-[#120d08]">
            <img
              src={encodeURI(season?.bannerImage || '/assets/Seasons/summer-season-ranking.webp')}
              alt=""
              fetchPriority="high"
              decoding="async"
              className="block h-auto w-full object-contain"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#09090c]/45 via-transparent to-transparent" />
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

          <div className={`flex min-h-0 flex-col ${isMobileWeb ? 'p-4' : 'p-5 md:p-6'}`}>
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
                <div className="mt-3 space-y-2">
                  {mySeasonRow && (
                    <Link
                      to={`/compete/player/${mySeasonRow.userId}`}
                      className="mb-1 flex items-center gap-3 rounded-xl border border-[#dc2626]/55 bg-[#dc2626]/12 px-3 py-2.5"
                    >
                      <span className="micro shrink-0 rounded-full border border-[#dc2626]/50 bg-[#dc2626]/20 px-2 py-1 text-[8px] font-black uppercase tracking-[0.14em] text-[#ff7184]">
                        {t('rating.you')}
                      </span>
                      <strong className="display w-8 shrink-0 text-lg font-black italic text-white">#{mySeasonIndex + 1}</strong>
                      {mySeasonRow.avatarUrl ? (
                        <AvatarImage src={mySeasonRow.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-[#dc2626]/70" sizePx={36} />
                      ) : (
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#dc2626]/40 bg-[#18181e] text-[10px] font-black uppercase text-white">
                          {mySeasonRow.name.slice(0, 2)}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm font-bold text-white">
                        {mySeasonRow.name}{countryFlag(mySeasonRow.country) ? ` ${countryFlag(mySeasonRow.country)}` : ''}
                      </span>
                      <b className={`num shrink-0 text-sm ${mySeasonRow.pnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {mySeasonRow.pnlUsd >= 0 ? '+' : ''}{mySeasonRow.pnlUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })} $
                      </b>
                    </Link>
                  )}
                  {mySeasonRow && (
                    <div className="flex items-center gap-3 py-2">
                      <span className="h-px flex-1 bg-white/10" />
                      <span className="micro text-[9px] font-black uppercase tracking-[0.16em] text-[#6f6973]">{t('rating.boardLabel')}</span>
                      <span className="h-px flex-1 bg-white/10" />
                    </div>
                  )}
                  {seasonRows.slice(0, seasonVisibleCount).map((row, index) => {
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
                  {seasonVisibleCount < seasonRows.length && (
                    <button
                      type="button"
                      onClick={() => setSeasonVisibleCount((count) => count + seasonPageSize)}
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
        )}

        {showSeason && (
        <div className={`mt-3 overflow-hidden rounded-3xl border border-[#f5b300]/30 bg-gradient-to-br from-[#211706] via-[#0d0a07] to-[#09090c] ${isMobileWeb ? 'p-3' : 'p-4'}`}>
          <div className="micro text-[10px] font-black uppercase tracking-[0.16em] text-[#f5b300]">
            {t('rating.seasonPrizesLabel')}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
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
                  className={`relative z-10 mx-auto w-auto select-none object-contain ${isMobileWeb ? 'h-14' : 'h-20 sm:h-24'}`}
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
        )}

        {/* Séparation explicite : le Rating permanent n'est pas qualificatif. */}
        {showRating && (
        <section className={`${isMobileWeb ? 'mt-1' : 'mt-2'} rounded-2xl border border-[#dc2626]/25 bg-[#dc2626]/[0.05] ${isMobileWeb ? 'px-4 py-3' : 'px-5 py-3.5'}`}>
          <div className="flex flex-wrap items-center gap-3">
            <span className="micro rounded-full border border-[#dc2626]/40 bg-[#dc2626]/10 px-2.5 py-1 text-[9px] text-[#ff7184]">
              {t('rating.permanentBadge')}
            </span>
            <strong className="display text-lg font-black uppercase text-white">{t('rating.permanentTitle')}</strong>
          </div>
          <p className={`${isMobileWeb ? 'mt-1.5 text-[12px]' : 'mt-1.5 text-sm'} text-[#a1a1aa]`}>{t('rating.permanentNotQualifying')}</p>
        </section>
        )}

        {/* ——— MON RATING ——— */}
        {showRating && myRating && (
        <section className={isMobileWeb ? 'mt-5' : 'mt-6'}>
          <div className="border-b border-[#1a1a20] pb-3">
            <div className="micro text-[10px] text-[#dc2626]">{t('rating.kicker')}</div>
            <h2 className="display mt-1 text-2xl font-bold text-white md:text-3xl">{t('rating.myDivision')}</h2>
          </div>
            <div className="mt-3">
              <RatingCard rating={myRating} />
            </div>
          </section>
        )}

        {/* ——— LES DIVISIONS ——— */}
        {showRating && (
        <section className={isMobileWeb ? 'mt-5' : 'mt-6'}>
          <div className="border-b border-[#1a1a20] pb-3">
            <div className="micro text-[10px] text-[#dc2626]">{t('rating.ladderKicker')}</div>
            <h2 className="display mt-1 text-2xl font-bold text-white md:text-3xl">{t('rating.ladderTitle')}</h2>
          </div>
          <div className={`mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] ${isMobileWeb ? '-mx-1 px-1' : ''}`}>
            {DIVISIONS.map((division) => {
              const color = DIVISION_COLORS[division.id];
              const isMine = myRating?.division.id === division.id;
              return (
                <div
                  key={division.id}
                  className={`flex shrink-0 flex-col items-center gap-1 rounded-xl border text-center ${
                    isMobileWeb ? 'w-[4.6rem] px-1.5 py-2' : 'w-[6.4rem] px-2 py-3'
                  } ${isMine ? 'ring-1' : ''}`}
                  style={{
                    borderColor: isMine ? color : 'rgba(255,255,255,0.08)',
                    background: `radial-gradient(80% 60% at 50% 0%, ${color}12, transparent 70%), #0b0b10`,
                  }}
                >
                  <DivisionBadge division={{ id: division.id, label: division.label, tier: 0 }} size={isMobileWeb ? 42 : 56} />
                  <div className={`display font-black uppercase text-white ${isMobileWeb ? 'text-[10px]' : 'text-[11px]'}`}>{division.label}</div>
                  {!isMobileWeb && (
                    <div className="num text-[9px] text-[#71717a]">
                      {Number.isFinite(division.ceiling)
                        ? `${division.floor}–${division.ceiling}`
                        : `${division.floor}+`}
                    </div>
                  )}
                  {isMine && (
                    <span className="micro text-[7px]" style={{ color }}>{t('rating.you')}</span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
        )}

        {/* ——— CLASSEMENT MONDIAL ——— */}
        {showRating && (
        <section className={isMobileWeb ? 'mt-5' : 'mt-6'}>
          <div className="border-b border-[#1a1a20] pb-3">
            <div>
              <div className="micro text-[10px] text-[#dc2626]">{t('rating.worldKicker')}</div>
              <h2 className="display mt-1 text-2xl font-bold text-white md:text-3xl">{t('rating.worldTitle')}</h2>
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
              {myWorldRow && (
                <Link
                  to={`/compete/player/${myWorldRow.userId}`}
                  className="mb-1 flex items-center gap-3 rounded-xl border border-[#dc2626]/55 bg-[#dc2626]/12 px-4 py-2.5"
                >
                  <span className="micro shrink-0 rounded-full border border-[#dc2626]/50 bg-[#dc2626]/20 px-2 py-1 text-[8px] font-black uppercase tracking-[0.14em] text-[#ff7184]">
                    {t('rating.you')}
                  </span>
                  <span className="display w-10 shrink-0 text-lg font-black italic text-white">#{myWorldRow.rank}</span>
                  {myWorldRow.avatarUrl ? (
                    <AvatarImage src={myWorldRow.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-[#dc2626]/70" sizePx={36} />
                  ) : (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#dc2626]/40 bg-[#18181e] text-[11px] font-black uppercase text-[#d4d4d8]">
                      {myWorldRow.name.slice(0, 2)}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-white">
                    {myWorldRow.name}{countryFlag(myWorldRow.country) ? ` ${countryFlag(myWorldRow.country)}` : ''}
                  </span>
                  <span
                    className="micro hidden rounded-full px-2.5 py-1 text-[9px] sm:inline-flex"
                    style={{
                      color: DIVISION_COLORS[myWorldRow.division.id] || '#cbd5e1',
                      border: `1px solid ${DIVISION_COLORS[myWorldRow.division.id] || '#cbd5e1'}55`,
                      background: `${DIVISION_COLORS[myWorldRow.division.id] || '#cbd5e1'}14`,
                    }}
                  >
                    {divisionDisplayName(myWorldRow.division)}
                  </span>
                  <span className="num shrink-0 text-sm font-bold" style={{ color: DIVISION_COLORS[myWorldRow.division.id] || '#cbd5e1' }}>
                    {myWorldRow.points} pts
                  </span>
                </Link>
              )}
              {myWorldRow && (
                <div className="flex items-center gap-3 py-2">
                  <span className="h-px flex-1 bg-white/10" />
                  <span className="micro text-[9px] font-black uppercase tracking-[0.16em] text-[#6f6973]">{t('rating.boardLabel')}</span>
                  <span className="h-px flex-1 bg-white/10" />
                </div>
              )}
              {rows.slice(0, visibleCount).map((row) => {
                const color = DIVISION_COLORS[row.division.id] || '#cbd5e1';
                const isMe = row.userId === currentUserId;
                return (
                  <Link
                    key={row.userId}
                    to={`/compete/player/${row.userId}`}
                    className={`grid grid-cols-[44px_44px_1fr_auto_auto] items-center gap-3 rounded-xl border px-4 py-2.5 transition-colors hover:border-white/20 ${
                      isMe ? 'border-[#dc2626]/50 bg-[#dc2626]/10' : 'border-white/[0.06] bg-[#0b0b10]'
                    }`}
                  >
                    <span className={`display text-lg font-black italic ${row.rank <= 3 ? 'text-[#f5b300]' : 'text-[#71717a]'}`}>
                      #{row.rank}
                    </span>
                    {row.avatarUrl ? (
                      <AvatarImage src={row.avatarUrl} alt="" className={`h-9 w-9 rounded-full object-cover ${isMe ? 'ring-2 ring-[#dc2626]/70' : ''}`} sizePx={36} />
                    ) : (
                      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-[#18181e] text-[11px] font-black uppercase text-[#d4d4d8]">
                        {row.name.slice(0, 2)}
                      </span>
                    )}
                    <span className="truncate text-sm font-bold text-white">
                      {row.name}{countryFlag(row.country) ? ` ${countryFlag(row.country)}` : ''}
                      {isMe && <small className="ml-2 text-[8px] uppercase tracking-wider text-[#ff7184]">{t('rating.you')}</small>}
                    </span>
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
        )}
      </main>
    </div>
  );
}
