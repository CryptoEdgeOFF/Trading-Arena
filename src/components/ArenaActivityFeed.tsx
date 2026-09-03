import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';

import { AvatarImage } from './OptimizedImage';
import { fmtAgo, getInitials } from '../utils/formatters';

const POLL_MS = 8000;
const MAX_VISIBLE = 8;

type ActivityEvent = {
  id: string;
  t: number;
  action: 'open' | 'close';
  userId: string;
  name: string;
  avatarUrl: string | null;
  asset: string;
  assetImageUrl: string | null;
};

/**
 * Flux d'activité de l'arène. Le serveur n'envoie ni sens ni taille de position :
 * on ne sait que qui a tradé, quand et sur quel marché.
 */
export default function ArenaActivityFeed({ competitionId, live }: { competitionId: string; live: boolean }) {
  const { t } = useTranslation();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const pausedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      if (cancelled) return;
      if (!pausedRef.current) {
        try {
          const response = await fetch(`/api/competition/leaderboard/${competitionId}/activity`);
          if (response.ok) {
            const payload = await response.json() as { events?: ActivityEvent[] };
            if (!cancelled) setEvents((payload.events || []).slice(0, MAX_VISIBLE));
          }
        } catch {
          // Le flux est décoratif : on réessaiera au prochain tick.
        }
        if (!cancelled) setLoaded(true);
      }
      if (!cancelled && live) timer = setTimeout(tick, POLL_MS);
    }

    void tick();
    const onVisibility = () => { pausedRef.current = document.hidden; };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [competitionId, live]);

  if (loaded && events.length === 0) return null;

  return (
    <section className="lb-panel">
      <div className="lb-panel__head">
        <div className="lb-panel__title text-[15px]">{t('leaderboard.feedTitle')}</div>
        {live && <span className="lb-dot lb-dot--on" />}
      </div>
      <div className="lb-feed">
        <AnimatePresence initial={false}>
          {events.map((event) => (
            <motion.div
              key={event.id}
              layout
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              className="lb-bubble"
            >
              <span className="lb-bubble__av">
                {event.avatarUrl ? (
                  <AvatarImage src={event.avatarUrl} alt={event.name} className="h-full w-full object-cover" sizePx={52} />
                ) : (
                  getInitials(event.name)
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="lb-bubble__txt">
                  <Link to={`/compete/player/${event.userId}`} className="font-bold text-white hover:underline">
                    {event.name}
                  </Link>{' '}
                  {t(event.action === 'close' ? 'leaderboard.feedClosed' : 'leaderboard.feedOpened')}{' '}
                  <span className="font-bold text-[#ff8a4c]">{event.asset}</span>
                </p>
                <div className="lb-bubble__meta">
                  {event.assetImageUrl && <img src={event.assetImageUrl} alt="" loading="lazy" />}
                  {fmtAgo(event.t)}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}
