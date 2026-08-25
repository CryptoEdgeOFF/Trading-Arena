import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import Seo, { SITE_URL } from './Seo';
import CompeteHeader from './CompeteHeader';
import OptimizedImage from './OptimizedImage';
import { markNewsRead } from '../lib/newsRead';
import { localizeNews } from '../lib/newsLocale';
import { youtubeVideoId } from '../lib/youtube';
import { newsCoverUrl } from '../utils/imageUrl';

type NewsArticle = {
  id: string;
  title: string;
  summary: string;
  body: string;
  titleEn?: string;
  summaryEn?: string;
  bodyEn?: string;
  coverUrl: string;
  featured: boolean;
  publishedAt: number;
  createdAt: number;
  updatedAt?: number;
};

function articleDate(article: NewsArticle) {
  return article.publishedAt || article.createdAt;
}

function formatDate(timestamp: number, locale: string) {
  return new Date(timestamp).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
}

function YouTubeEmbed({ id }: { id: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-black">
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${id}`}
        title="YouTube"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        className="aspect-video w-full"
      />
    </div>
  );
}

function RichText({ text }: { text: string }) {
  return (
    <div className="grid gap-4">
      {text.split(/\n{2,}/).map((paragraph, index) => {
        const youtubeId = youtubeVideoId(paragraph.trim());
        if (youtubeId) return <YouTubeEmbed key={`${index}-${youtubeId}`} id={youtubeId} />;
        return (
          <p key={`${index}-${paragraph.slice(0, 12)}`} className="whitespace-pre-wrap text-[15px] leading-7 text-[#d4d4dc]">
            {paragraph.split(/(https?:\/\/[^\s]+)/g).map((part, partIndex) => (
              /^https?:\/\//.test(part)
                ? <a key={partIndex} href={part} target="_blank" rel="noopener noreferrer" className="text-[#ff6275] underline">{part}</a>
                : part
            ))}
          </p>
        );
      })}
    </div>
  );
}

export default function CompetitionNewsPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const [news, setNews] = useState<NewsArticle[]>([]);
  const [article, setArticle] = useState<NewsArticle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void (async () => {
      try {
        if (id) {
          const response = await fetch(`/api/news/${encodeURIComponent(id)}`);
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || t('news.loadError'));
          if (active) {
            setArticle(data.article || null);
            markNewsRead(Number(data.article?.publishedAt || data.article?.createdAt || Date.now()));
          }
        } else {
          const response = await fetch('/api/news?limit=40');
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || t('news.loadError'));
          if (active) {
            setNews(data.news || []);
            setArticle(null);
            const latest = data.news?.[0];
            markNewsRead(Number(latest?.publishedAt || latest?.createdAt || Date.now()));
          }
        }
      } catch (nextError) {
        if (active) setError(nextError instanceof Error ? nextError.message : t('news.loadError'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false };
  }, [id, t]);

  const visibleArticle = article ? localizeNews(article, i18n.language) : null;

  return (
    <div className="compete min-h-dvh-safe bg-[#050507]">
      <Seo
        title={visibleArticle ? visibleArticle.title : t('seo.newsTitle')}
        description={visibleArticle?.summary || t('seo.newsDesc')}
        path={article ? `/compete/news/${article.id}` : '/compete/news'}
        type={visibleArticle ? 'article' : 'website'}
        image={visibleArticle?.coverUrl
          ? `${SITE_URL}${newsCoverUrl(visibleArticle.coverUrl, 'og') || visibleArticle.coverUrl}`
          : undefined}
        jsonLd={visibleArticle && article ? {
          '@context': 'https://schema.org',
          '@type': 'NewsArticle',
          headline: visibleArticle.title,
          description: visibleArticle.summary,
          image: visibleArticle.coverUrl
            ? [`${SITE_URL}${newsCoverUrl(visibleArticle.coverUrl, 'full') || visibleArticle.coverUrl}`]
            : undefined,
          datePublished: new Date(articleDate(visibleArticle)).toISOString(),
          dateModified: new Date(article.updatedAt || articleDate(visibleArticle)).toISOString(),
          inLanguage: i18n.language?.startsWith('fr') ? 'fr' : 'en',
          author: { '@type': 'Organization', name: 'BTF Arena' },
          publisher: {
            '@type': 'Organization',
            name: 'BTF Arena',
            logo: { '@type': 'ImageObject', url: `${SITE_URL}/favicon-192.png` },
          },
          mainEntityOfPage: `${SITE_URL}/compete/news/${article.id}`,
        } : undefined}
      />
      <div className="compete-bg min-h-dvh-safe">
        <CompeteHeader />
        <main className="mx-auto max-w-4xl px-5 py-10 md:px-8">
          {visibleArticle ? (
            <motion.article
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              <button
                type="button"
                onClick={() => navigate('/compete/news')}
                className="micro mb-6 text-[10px] text-[#8b8490] transition-colors hover:text-white"
              >
                ‹ {t('news.back')}
              </button>
              {visibleArticle.coverUrl && (
                <OptimizedImage
                  src={visibleArticle.coverUrl}
                  alt={visibleArticle.title}
                  displayWidth={1400}
                  width={1600}
                  height={900}
                  sizes="(max-width: 896px) 100vw, 896px"
                  priority
                  className="mb-6 h-56 w-full rounded-2xl border border-white/[0.08] object-cover md:h-72"
                />
              )}
              <div className="micro text-[10px] text-[#dc2626]">
                {visibleArticle.featured ? `${t('news.featured')} · ` : ''}
                {formatDate(articleDate(visibleArticle), i18n.language)}
              </div>
              <h1 className="display mt-2 text-4xl font-black uppercase italic leading-none text-white md:text-5xl">
                {visibleArticle.title}
              </h1>
              {visibleArticle.summary && <p className="mt-4 text-base leading-relaxed text-[#b8b8c2]">{visibleArticle.summary}</p>}
              <div className="mt-8">
                <RichText text={visibleArticle.body} />
              </div>
            </motion.article>
          ) : (
            <>
              <div className="mb-8">
                <div className="micro text-[10px] text-[#dc2626]">{t('news.kicker')}</div>
                <h1 className="display mt-2 text-4xl font-black uppercase italic text-white md:text-5xl">{t('news.title')}</h1>
                <p className="mt-3 max-w-xl text-sm text-[#a1a1aa]">{t('news.lead')}</p>
              </div>
              {loading ? <div className="py-20 text-center text-sm text-[#71717a]">{t('news.loading')}</div>
                : error ? <div className="py-20 text-center text-sm text-[#ff7888]">{error}</div>
                  : !news.length ? <div className="py-20 text-center text-sm text-[#71717a]">{t('news.empty')}</div>
                    : (
                      <div className="grid gap-3">
                        {news.map((item) => {
                          const localized = localizeNews(item, i18n.language);
                          return (
                          <Link
                            key={item.id}
                            to={`/compete/news/${item.id}`}
                            className={`group grid overflow-hidden rounded-2xl border bg-[#0b0b10] transition-colors hover:border-white/20 ${
                              item.coverUrl ? 'grid-cols-[140px_minmax(0,1fr)] sm:grid-cols-[180px_minmax(0,1fr)]' : ''
                            } ${item.featured ? 'border-[#dc2626]/40' : 'border-white/[0.07]'}`}
                          >
                            {item.coverUrl && (
                              <OptimizedImage
                                src={item.coverUrl}
                                alt={localized.title}
                                displayWidth={360}
                                width={640}
                                height={360}
                                sizes="180px"
                                className="h-full min-h-[120px] w-full object-cover"
                              />
                            )}
                            <span className="flex flex-col justify-center p-4 sm:p-5">
                              <small className="micro text-[9px] text-[#8b8490]">
                                {item.featured ? `${t('news.featured')} · ` : ''}
                                {formatDate(articleDate(item), i18n.language)}
                              </small>
                              <strong className="display mt-1 text-xl font-black uppercase italic text-white sm:text-2xl">
                                {localized.title}
                              </strong>
                              <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-[#9a949e]">
                                {localized.summary || localized.body}
                              </p>
                              <em className="mt-3 text-[11px] font-bold not-italic uppercase tracking-[0.12em] text-[#e0dae2]">
                                {t('news.read')} <b className="text-[#ee243c]">›</b>
                              </em>
                            </span>
                          </Link>
                          );
                        })}
                      </div>
                    )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
