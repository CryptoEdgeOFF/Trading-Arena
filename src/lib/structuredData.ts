import { SITE_URL } from '../components/Seo';

export interface ArenaEventInput {
  id: string;
  title: string;
  startAt: number;
  endAt: number;
  status?: 'registration' | 'starting_soon' | 'live' | 'ended';
  bannerImageUrl?: string | null;
  /** Prize pool label/total used for the event description, when available. */
  prizeLabel?: string | null;
}

/**
 * Builds a schema.org Event for a trading arena (online competition).
 * Eligible for Google "Event" rich results.
 */
export function buildArenaEventJsonLd(arena: ArenaEventInput): Record<string, unknown> {
  const url = `${SITE_URL}/compete/leaderboard/${arena.id}`;
  const image = arena.bannerImageUrl
    ? (arena.bannerImageUrl.startsWith('http') ? arena.bannerImageUrl : `${SITE_URL}${arena.bannerImageUrl}`)
    : `${SITE_URL}/og-image.png`;
  const descriptionParts = [
    `Compétition de trading en ligne gratuite sur BTF Arena${arena.prizeLabel ? ` — ${arena.prizeLabel} à gagner` : ''}.`,
    'Affronte des traders du monde entier et grimpe au classement en temps réel.',
  ];
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: arena.title,
    startDate: new Date(arena.startAt).toISOString(),
    endDate: new Date(arena.endAt).toISOString(),
    eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
    eventStatus: 'https://schema.org/EventScheduled',
    location: {
      '@type': 'VirtualLocation',
      url,
    },
    image: [image],
    description: descriptionParts.join(' '),
    url,
    organizer: {
      '@type': 'Organization',
      name: 'BTF Arena',
      url: `${SITE_URL}/`,
    },
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock',
      url,
      validFrom: new Date(arena.startAt).toISOString(),
    },
  };
}

/** Wraps several arena events into an ItemList for listing pages (home). */
export function buildArenaItemListJsonLd(arenas: ArenaEventInput[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: arenas.slice(0, 20).map((arena, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: buildArenaEventJsonLd(arena),
    })),
  };
}
