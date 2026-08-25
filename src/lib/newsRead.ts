const NEWS_READ_KEY = 'btf-news-last-read-at';
export const NEWS_READ_EVENT = 'btf-news-read';

export function readLastNewsReadAt(): number {
  try {
    return Number(window.localStorage.getItem(NEWS_READ_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function markNewsRead(at = Date.now()): void {
  const previous = readLastNewsReadAt();
  if (at <= previous) return;
  try {
    window.localStorage.setItem(NEWS_READ_KEY, String(at));
  } catch {
    // ignore quota
  }
  window.dispatchEvent(new Event(NEWS_READ_EVENT));
}

export function hasUnreadNews(latestPublishedAt: number | null | undefined): boolean {
  if (!latestPublishedAt) return false;
  return latestPublishedAt > readLastNewsReadAt();
}
