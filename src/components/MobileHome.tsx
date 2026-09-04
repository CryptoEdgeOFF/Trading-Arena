import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AvatarImage } from './OptimizedImage';
import {
  DivisionBadge,
  divisionDisplayName,
  divisionProgress,
  type PlayerRating,
} from './playerRating';
import { countryFlag } from '../lib/country';
import { localizeNews } from '../lib/newsLocale';
import { hasUnreadNews } from '../lib/newsRead';
import { newsCoverUrl, resolveMediaUrl } from '../utils/imageUrl';
import { ninjaTraderCupBanner, resolveArenaBrand } from '../lib/sponsors';
import { formatDHMS } from '../utils/formatters';
import type { CompeteSessionUser } from '../lib/competeSession';
import HomeSeasonBoard from './HomeSeasonBoard';
import HomeBonusBanner from './HomeBonusBanner';

type HomeNews = {
  id: string;
  title: string;
  summary: string;
  body?: string;
  titleEn?: string;
  summaryEn?: string;
  bodyEn?: string;
  coverUrl: string;
  featured: boolean;
  publishedAt: number;
  createdAt: number;
};

type HomeArena = {
  id: string;
  title: string;
  status: 'registration' | 'starting_soon' | 'live' | 'ended';
  startAt: number;
  endAt: number;
  bannerImageUrl?: string | null;
  sponsor?: string | null;
  sponsorName?: string | null;
  sponsorLogoUrl?: string | null;
  canJoin?: boolean;
  joined?: boolean;
  myEntry?: { pnlUsd: number; pnlPercent: number };
};

type HomeSeason = {
  nameKey: string;
  homeBannerImage?: string | null;
};

function useCountdown(target: number): string {
  const { i18n } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return formatDHMS(target - now, i18n.language.startsWith('fr') ? 'j' : 'd');
}

function MobileArenaCard({
  arena,
  variant = 'live',
  onTrade,
  onJoin,
  onLeaderboard,
}: {
  arena: HomeArena;
  variant?: 'live' | 'join';
  onTrade?: (id: string) => void;
  onJoin?: (id: string) => void;
  onLeaderboard: (id: string) => void;
}) {
  const { t } = useTranslation();
  const countdown = useCountdown(arena.status === 'live' ? arena.endAt : arena.startAt);
  const pnl = arena.myEntry?.pnlUsd ?? 0;
  const brand = resolveArenaBrand(arena, resolveMediaUrl);
  const clearBanner = resolveMediaUrl(arena.bannerImageUrl) || ninjaTraderCupBanner(arena);
  const fallbackBanner = '/assets/pictures/arena-live-red.webp';
  const joining = variant === 'join';

  return (
    <article className={`mobile-arena-card${joining ? ' is-join' : ''}${clearBanner ? ' has-clear-banner' : ''}`}>
      <img className="mobile-arena-card__banner" src={clearBanner || fallbackBanner} alt={clearBanner ? arena.title : ''} loading="lazy" decoding="async" />
      {!clearBanner && <div className="mobile-arena-card__shade" />}
      <div className="mobile-arena-card__top">
        <span className={`mobile-arena-card__live${joining ? ' is-open' : ''}`}>
          <i />{joining ? t('home.openForJoin') : t('status.live')}
        </span>
        {brand?.logoUrl && (
          <img className="mobile-arena-card__logo" src={brand.logoUrl} alt={brand.name} />
        )}
      </div>
      <h3>{arena.title}</h3>
      <div className="mobile-arena-card__meta">
        <div>
          <small>{joining ? t('home.startsIn') : t('spotlight.endsIn')}</small>
          <strong>{countdown}</strong>
          {arena.myEntry && !joining && (
            <strong className={pnl >= 0 ? 'is-profit' : 'is-loss'}>
              {pnl >= 0 ? '+' : ''}{pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })} $
            </strong>
          )}
        </div>
        <div className="mobile-arena-card__actions">
          {joining ? (
            arena.joined ? (
              <span className="mobile-arena-card__joined">{t('publicCard.joined')}</span>
            ) : (
              <button type="button" onClick={() => onJoin?.(arena.id)}>{t('spotlight.join')}</button>
            )
          ) : (
            <button type="button" onClick={() => onTrade?.(arena.id)}>{t('header.trade')}</button>
          )}
          <button type="button" onClick={() => onLeaderboard(arena.id)}>{t('common.leaderboard')}</button>
        </div>
      </div>
    </article>
  );
}

export default function MobileHome({
  user,
  rating,
  stats,
  totalPnl,
  arenas,
  joinableArenas,
  latestNews,
  authSlot,
  onAuthIntent,
  onRefresh,
  onTrade,
  onJoin,
  onLeaderboard,
}: {
  user: CompeteSessionUser | null;
  rating: PlayerRating | null;
  stats: { profitFactor: number | null } | null;
  totalPnl: number;
  arenas: HomeArena[];
  joinableArenas: HomeArena[];
  latestNews: HomeNews[];
  season: HomeSeason | null;
  authSlot?: ReactNode;
  onAuthIntent: (intent: 'login' | 'signup') => void;
  onRefresh: () => void;
  onTrade: (competitionId: string) => void;
  onJoin: (competitionId: string) => void;
  onLeaderboard: (competitionId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [authOpen, setAuthOpen] = useState(false);
  const showAuth = authOpen || location.hash === '#signup';
  const hour = new Date().getHours();
  const greeting = hour >= 18 || hour < 5 ? t('home.greetingEvening') : t('home.greetingMorning');
  const unread = hasUnreadNews(latestNews[0]?.publishedAt || latestNews[0]?.createdAt);
  const locale = i18n.language.startsWith('fr') ? 'fr-FR' : 'en-US';

  const newsBell = (
    <Link to="/compete/news" className="mobile-home__news" aria-label={t('home.openNews')}>
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Zm-8 12h4" />
      </svg>
      {unread && <b className="mobile-home__news-badge">•</b>}
    </Link>
  );

  useEffect(() => {
    if (location.hash !== '#signup') return;
    const timer = window.setTimeout(() => {
      document.getElementById('signup')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [location.hash]);

  function openAuth(intent: 'login' | 'signup') {
    onAuthIntent(intent);
    setAuthOpen(true);
  }

  const liveArenas = useMemo(
    () => arenas.filter((arena) => arena.status === 'live').sort((a, b) => a.endAt - b.endAt),
    [arenas],
  );

  return (
    <div className="mobile-home">
      {user ? (
        <>
          <header className="mobile-home__topbar">
            <img className="mobile-home__logo" src="/assets/pictures/btf-logo-header.png" alt="BTF Arena" />
            {newsBell}
          </header>

          <section className={`mobile-player-card${rating ? ` is-${rating.division.id}` : ''}`}>
            <i className="mobile-player-card__fx" aria-hidden="true" />
            <div className="mobile-player-card__identity">
              <Link
                to={`/compete/player/${user.id}`}
                className="mobile-player-card__avatar"
                aria-label={t('home.openProfile')}
              >
                {user.avatarUrl ? (
                  <AvatarImage key={user.avatarUrl} src={user.avatarUrl} alt="" className="h-full w-full object-cover" sizePx={44} />
                ) : (
                  user.name.slice(0, 2)
                )}
              </Link>
              <div>
                <small>{greeting}</small>
                <strong>
                  {countryFlag(user.country)} {user.name}
                </strong>
              </div>
            </div>

            <div className="mobile-player-card__body">
              <div className="mobile-player-card__stats">
                <button type="button" className={totalPnl >= 0 ? 'is-profit' : 'is-loss'} onClick={() => navigate(`/compete/player/${user.id}`)}>
                  <small>{t('home.pnlGlobal')}</small>
                  <strong>{totalPnl >= 0 ? '+' : ''}{totalPnl.toLocaleString(locale, { maximumFractionDigits: 2 })} $</strong>
                </button>
                <button type="button" onClick={() => navigate(`/compete/player/${user.id}`)}>
                  <small>{t('home.profitFactor')}</small>
                  <strong>{stats?.profitFactor == null ? '—' : stats.profitFactor.toFixed(2)}</strong>
                </button>
                <button type="button" onClick={() => navigate('/compete/rank#rating')}>
                  <small>{t('home.worldRank')}</small>
                  <strong>
                    {rating?.worldRank != null
                      ? `#${rating.worldRank.toLocaleString(locale)} / ${rating.totalPlayers.toLocaleString(locale)}`
                      : '—'}
                  </strong>
                </button>
              </div>
              {rating && (
                <Link className="mobile-player-card__badge" to="/compete/rank#rating" aria-label={t('rating.kicker')}>
                  <DivisionBadge division={rating.division} size={96} />
                </Link>
              )}
            </div>

            {rating && (
              <Link className="mobile-player-card__progress" to="/compete/rank#rating">
                <span>
                  <strong>
                    {divisionDisplayName(rating.division)}
                    <small className="mobile-player-card__scope">{t('home.permanent')}</small>
                  </strong>
                  <em>
                    {rating.next
                      ? t('home.toNext', { points: rating.next.pointsNeeded.toLocaleString(locale), label: rating.next.label })
                      : t('home.maxDivision')}
                  </em>
                </span>
                <i className="mobile-player-card__bar" aria-hidden="true">
                  <b style={{ width: `${divisionProgress(rating)}%` }} />
                </i>
              </Link>
            )}
          </section>
        </>
      ) : (
        <>
          <section className="mobile-home-guest">
            <img className="mobile-home-guest__backdrop" src="/assets/pictures/Traderpng.webp" alt="" fetchPriority="high" />
            <i className="mobile-home-guest__shade" aria-hidden="true" />
            <img className="mobile-home-guest__brand" src="/assets/pictures/BTF_ARENA_logo.png" alt="BTF Arena" />
            <div className="mobile-home-guest__news">{newsBell}</div>
            <div className="mobile-home-guest__content">
              <div className="eyebrow"><span /> {t('home.guestEyebrow')}</div>
              <h1>{t('home.guestTitle')}<br /><em>{t('home.guestTitleEm')}</em></h1>
              <p>{t('home.guestLead')}</p>
              <div className="mobile-home-guest__actions">
                <button type="button" onClick={() => openAuth('login')}>{t('auth.tabLogin')}</button>
                <button type="button" onClick={() => openAuth('signup')}>{t('auth.tabSignup')}</button>
              </div>
            </div>
          </section>

          {showAuth && authSlot && (
            <div id="signup" className="mobile-home-guest__auth">{authSlot}</div>
          )}

          <section className="mobile-home-process">
            <div className="mobile-home-process__head">
              <span>{t('process.eyebrow')}</span>
              <h2>{t('process.title')}</h2>
              <p>{t('process.sub')}</p>
            </div>
            <ol>
              {[
                [t('process.step1Title'), t('process.step1Text')],
                [t('process.step2Title'), t('process.step2Text')],
                [t('process.step3Title'), t('process.step3Text')],
              ].map(([title, text], index) => (
                <li key={title}>
                  <b>{String(index + 1).padStart(2, '0')}</b>
                  <span><strong>{title}</strong><small>{text}</small></span>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}

      {joinableArenas.length > 0 && (
        <section>
          <div className="mobile-home__section-title">
            <div>
              <span>{t('home.competitions')}</span>
              <h2>{t('home.openForJoin')}</h2>
            </div>
          </div>
          <div className="mobile-home__join">
            {joinableArenas.map((arena) => (
              <MobileArenaCard
                key={arena.id}
                arena={arena}
                variant="join"
                onJoin={onJoin}
                onLeaderboard={onLeaderboard}
              />
            ))}
          </div>
        </section>
      )}

      {latestNews.length > 0 && (
        <section className="mobile-home-news">
          <div className="mobile-home-news__head">
            <span>{t('news.homeBanner')}</span>
            <Link to="/compete/news">{t('news.homeAll')} →</Link>
          </div>
          {latestNews.map((article) => {
            const localized = localizeNews({ ...article, body: article.body || '' }, i18n.language);
            return (
              <Link key={article.id} to={`/compete/news/${article.id}`} className="mobile-home-news__card">
                {article.coverUrl && (
                  <img src={newsCoverUrl(article.coverUrl, 'card') || article.coverUrl} alt={localized.title} />
                )}
                <span>
                  <small>
                    {article.featured ? `${t('news.featured')} · ` : ''}
                    {new Date(article.publishedAt || article.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}
                  </small>
                  <strong>{localized.title}</strong>
                </span>
              </Link>
            );
          })}
        </section>
      )}

      {user && liveArenas.length > 0 && (
        <section>
          <div className="mobile-home__section-title">
            <div>
              <span>{t('home.competitions')}</span>
              <h2>{t('home.current')}</h2>
            </div>
            <button type="button" onClick={onRefresh} aria-label={t('common.refresh')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
              </svg>
            </button>
          </div>
          <div className="mobile-home__arenas">
            {liveArenas.map((arena) => (
              <MobileArenaCard
                key={arena.id}
                arena={arena}
                onTrade={onTrade}
                onLeaderboard={onLeaderboard}
              />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mobile-home__section-title">
          <div>
            <span>{t('sections.seasonEyebrow')}</span>
          </div>
        </div>
        <HomeSeasonBoard />
      </section>
      <HomeBonusBanner compact />

    </div>
  );
}
