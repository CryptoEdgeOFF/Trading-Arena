type PublicNewsArticle = {
  id: string;
  title: string;
  summary: string;
  titleEn?: string;
  summaryEn?: string;
  coverUrl: string;
  featured: boolean;
  publishedAt: number | null;
  createdAt: number;
};

let inflight: Promise<PublicNewsArticle[]> | null = null;
let cached: { at: number; news: PublicNewsArticle[] } | null = null;
const CACHE_MS = 15_000;

export async function fetchPublicNews(limit = 2): Promise<PublicNewsArticle[]> {
  const safeLimit = Math.max(1, Math.min(40, limit));
  if (cached && Date.now() - cached.at < CACHE_MS && cached.news.length >= safeLimit) {
    return cached.news.slice(0, safeLimit);
  }
  if (!inflight) {
    inflight = fetch('/api/news?limit=40')
      .then(async (response) => {
        if (!response.ok) throw new Error('unavailable');
        const payload = await response.json() as { news?: PublicNewsArticle[] };
        const news = Array.isArray(payload.news) ? payload.news : [];
        cached = { at: Date.now(), news };
        return news;
      })
      .finally(() => {
        inflight = null;
      });
  }
  const news = await inflight;
  return news.slice(0, safeLimit);
}
