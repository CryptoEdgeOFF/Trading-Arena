import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AvatarImage } from './OptimizedImage';
import { countryFlag } from '../lib/country';
import { formatDHMS } from '../utils/formatters';
import { getBadgeVisual, type UserBadge } from './playerBadges';
import './HomeSeasonBoard.css';

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
  status: 'upcoming' | 'active' | 'ended';
  endAt?: number;
  bannerImage?: string | null;
  homeBannerImage?: string | null;
  championBadge?: UserBadge;
  shirtImage?: string | null;
  arenaImage?: string | null;
};

function initials(name: string) {
  return name.split(' ').map((word) => word[0]).join('').slice(0, 2).toUpperCase();
}

export default function HomeSeasonBoard() {
  const { t, i18n } = useTranslation();
  const [rows, setRows] = useState<SeasonRow[]>([]);
  const [season, setSeason] = useState<SeasonSummary | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const seasonsResponse = await fetch('/api/competition/seasons');
        const seasonsPayload = seasonsResponse.ok
          ? await seasonsResponse.json() as { seasons?: SeasonSummary[]; activeSeasonId?: string | null }
          : { seasons: [] as SeasonSummary[] };
        const seasons = Array.isArray(seasonsPayload.seasons) ? seasonsPayload.seasons : [];
        const season = seasons.find((item) => item.id === seasonsPayload.activeSeasonId)
          || seasons.find((item) => item.status === 'active')
          || seasons.find((item) => item.status !== 'upcoming')
          || null;
        const seasonId = season?.id || 'summer-2026';
        const boardResponse = await fetch(`/api/competition/global-leaderboard?season=${encodeURIComponent(seasonId)}&fields=lite`);
        const boardPayload = boardResponse.ok
          ? await boardResponse.json() as { rows?: SeasonRow[] }
          : { rows: [] };
        if (cancelled) return;
        setRows(Array.isArray(boardPayload.rows) ? boardPayload.rows : []);
        setSeason(season);
      } catch {
        if (!cancelled) setRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const ranked = rows.map((row, index) => ({ ...row, rank: index + 1 }));
  const podium = [ranked[1], ranked[0], ranked[2]].filter(Boolean);
  const runners = ranked.slice(3, 6);
  const banner = season?.bannerImage || season?.homeBannerImage || '/assets/Seasons/summer-season-ranking.webp';
  const remaining = season?.endAt && season.endAt > now
    ? formatDHMS(season.endAt - now, i18n.language.startsWith('fr') ? 'j' : 'd')
    : null;
  const prizes = [
    {
      src: season?.championBadge
        ? getBadgeVisual(season.championBadge).src
        : '/assets/badges/summer-season-badge.webp',
      label: t('homeSeason.prizeBadge'),
    },
    {
      src: season?.shirtImage || '/assets/badges/summer-season-shirt.webp',
      label: t('homeSeason.prizeShirt'),
    },
    {
      src: season?.arenaImage || '/assets/pictures/arena3d.webp',
      label: t('homeSeason.prizeArena'),
    },
  ];

  return (
    <section className="home-season-board">
      <div className="home-season-board__banner">
        <img src={encodeURI(banner)} alt="" />
        {season?.endAt ? (
          <div className="home-season-board__clock">
            <small>{remaining ? t('rating.seasonEndsIn') : t('rating.seasonEnded')}</small>
            {remaining && <b>{remaining}</b>}
          </div>
        ) : null}
      </div>

      <div className="home-season-board__rank">
        {podium.length > 0 && (
          <div className="home-season-board__podium">
            {podium.map((player) => (
              <Link
                key={player.userId}
                to={`/compete/player/${player.userId}`}
                className={`home-season-board__player is-rank-${player.rank}`}
              >
                <i>{player.rank}</i>
                <span>
                  {player.avatarUrl
                    ? <AvatarImage src={player.avatarUrl} alt="" sizePx={player.rank === 1 ? 66 : 52} />
                    : initials(player.name)}
                </span>
                <strong>
                  {player.name}{countryFlag(player.country) ? ` ${countryFlag(player.country)}` : ''}
                </strong>
                <em>{player.pnlUsd >= 0 ? '+' : ''}{player.pnlUsd.toFixed(0)} $</em>
                <small>{t('homeSeason.arenas', { count: player.arenas })}</small>
              </Link>
            ))}
          </div>
        )}

        <div className="home-season-board__runners">
          {runners.map((player) => (
            <Link key={player.userId} to={`/compete/player/${player.userId}`}>
              <i>#{player.rank}</i>
              <strong>
                {player.name}{countryFlag(player.country) ? ` ${countryFlag(player.country)}` : ''}
              </strong>
              <em>{player.pnlUsd >= 0 ? '+' : ''}{player.pnlUsd.toFixed(0)} $</em>
            </Link>
          ))}
          <Link className="home-season-board__more" to="/compete/rank#season">
            {t('homeSeason.seeFull')} <b>›</b>
          </Link>
        </div>
      </div>

      <div className="home-season-board__prizes">
        <small>{t('homeSeason.prizesLabel')}</small>
        <div>
          {prizes.map((prize) => (
            <article key={prize.label}>
              <img src={encodeURI(prize.src)} alt="" />
              <strong>{prize.label}</strong>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
