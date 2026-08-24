import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import CompeteHeader from './CompeteHeader';
import Seo from './Seo';
import { formatDHMS } from '../utils/formatters';
import { resolveMediaUrl } from '../utils/imageUrl';

type Arena = {
  id: string;
  title: string;
  startAt: number;
  endAt: number;
  participants: number;
  status: 'registration' | 'starting_soon' | 'live' | 'ended';
  bannerImageUrl?: string | null;
  dailyDrawdownPercent?: number | null;
};

function useCountdown(target: number) {
  const { i18n } = useTranslation();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return formatDHMS(target - now, i18n.language.startsWith('fr') ? 'j' : 'd');
}

function ArenaCard({ arena, featured = false }: { arena: Arena; featured?: boolean }) {
  const { t, i18n } = useTranslation();
  const isLive = arena.status === 'live';
  const countdown = useCountdown(isLive ? arena.endAt : arena.startAt);
  const destination = isLive ? `/compete/leaderboard/${arena.id}` : `/compete?arena=${arena.id}`;

  return (
    <article className={`group relative overflow-hidden border border-white/[0.09] bg-[#0a0a0e] ${featured ? 'min-h-[430px] rounded-3xl' : 'min-h-[290px] rounded-2xl'}`}>
      <img
        src={resolveMediaUrl(arena.bannerImageUrl) || '/assets/pictures/arena3d.png'}
        alt=""
        className="absolute inset-0 h-full w-full object-cover opacity-60 transition duration-700 group-hover:scale-[1.035] group-hover:opacity-75"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-[#050507] via-[#050507]/55 to-black/10" />
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-5">
        <span className={`micro inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[9px] ${isLive ? 'border-[#ef233c]/55 bg-[#ef233c]/15 text-white' : 'border-white/15 bg-black/45 text-[#d4d4d8]'}`}>
          {isLive && <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ff314d] shadow-[0_0_10px_#ef233c]" />}
          {isLive ? t('status.live') : t('status.registration')}
        </span>
        <span className="micro text-[9px] text-white/65">{arena.participants} {t('spotlight.traders')}</span>
      </div>
      <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
        <div className="micro text-[9px] text-[#ff5268]">{t('livePage.weeklyArena')}</div>
        <h2 className={`display mt-1 font-black uppercase italic text-white ${featured ? 'text-4xl md:text-6xl' : 'text-3xl'}`}>{arena.title}</h2>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4 border-t border-white/10 pt-4">
          <div>
            <span className="micro block text-[8px] text-[#77717a]">{isLive ? t('spotlight.endsIn') : t('spotlight.startsIn')}</span>
            <strong className="num mt-1 block text-xl font-black text-white">{countdown}</strong>
            <small className="mt-1 block text-[10px] text-[#77717a]">
              {new Date(arena.startAt).toLocaleString(i18n.language, { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC
            </small>
          </div>
          <Link to={destination} className="blood-cta px-5 py-3 text-[10px] uppercase tracking-[0.14em]">
            {isLive ? t('spotlight.watch') : t('spotlight.join')} →
          </Link>
        </div>
      </div>
    </article>
  );
}

export default function CompetitionLivePage() {
  const { t } = useTranslation();
  const [arenas, setArenas] = useState<Arena[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/competition/public')
      .then(async (response) => {
        if (!response.ok) throw new Error('unavailable');
        return response.json() as Promise<{ competitions?: Arena[] }>;
      })
      .then((payload) => {
        if (!cancelled) setArenas(Array.isArray(payload.competitions) ? payload.competitions : []);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const active = useMemo(
    () => arenas
      .filter((arena) => arena.status !== 'ended')
      .sort((a, b) => (a.status === 'live' ? -1 : b.status === 'live' ? 1 : a.startAt - b.startAt)),
    [arenas],
  );
  const featured = active[0] || null;

  return (
    <div className="compete min-h-dvh-safe bg-[#050507]">
      <Seo title={t('livePage.seoTitle')} description={t('livePage.seoDesc')} path="/compete/live" />
      <CompeteHeader />
      <div className="compete-bg" />
      <main className="relative mx-auto max-w-6xl px-5 pb-24 pt-10 md:px-10">
        <motion.header initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="micro flex items-center gap-2 text-[10px] text-[#ff5268]"><i className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ef233c]" />{t('livePage.kicker')}</div>
            <h1 className="display mt-2 text-4xl font-black uppercase italic text-white md:text-6xl">{t('livePage.title')}</h1>
            <p className="mt-2 max-w-xl text-sm text-[#8f8b93]">{t('livePage.lead')}</p>
          </div>
          <div className="micro border-l border-[#ef233c] pl-3 text-[9px] leading-relaxed text-[#77717a]">
            {t('livePage.schedule')}<br /><b className="text-white">{t('livePage.scheduleValue')}</b>
          </div>
        </motion.header>

        {loading ? (
          <div className="glass-card p-16 text-center text-sm text-[#8f8b93]">{t('common.loading')}</div>
        ) : featured ? (
          <>
            <motion.div initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.08 }}>
              <ArenaCard arena={featured} featured />
            </motion.div>
            {active.length > 1 && (
              <section className="mt-10">
                <div className="mb-4 flex items-center gap-3"><span className="h-px flex-1 bg-white/10" /><h2 className="micro text-[10px] text-[#a1a1aa]">{t('livePage.upcoming')}</h2><span className="h-px flex-1 bg-white/10" /></div>
                <div className="grid gap-4 md:grid-cols-2">{active.slice(1).map((arena) => <ArenaCard key={arena.id} arena={arena} />)}</div>
              </section>
            )}
          </>
        ) : (
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0a0a0e] px-6 py-20 text-center">
            <img src="/assets/pictures/arena3d.png" alt="" className="absolute inset-0 h-full w-full object-contain opacity-20" />
            <div className="relative"><div className="micro text-[10px] text-[#ef233c]">{t('livePage.weeklyArena')}</div><h2 className="display mt-2 text-3xl font-black uppercase text-white">{t('livePage.emptyTitle')}</h2><p className="mt-2 text-sm text-[#77717a]">{t('livePage.emptyLead')}</p></div>
          </div>
        )}
      </main>
    </div>
  );
}
