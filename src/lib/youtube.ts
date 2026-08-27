const YOUTUBE_ID = /^[a-zA-Z0-9_-]{11}$/;

export function youtubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = parsed.pathname.split('/').filter(Boolean)[0] || '';
      return YOUTUBE_ID.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      const fromQuery = parsed.searchParams.get('v') || '';
      if (YOUTUBE_ID.test(fromQuery)) return fromQuery;
      const embed = parsed.pathname.match(/\/(?:embed|shorts|live)\/([a-zA-Z0-9_-]{11})/);
      return embed?.[1] || null;
    }
  } catch {
    return null;
  }
  return null;
}
