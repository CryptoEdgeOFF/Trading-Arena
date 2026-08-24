import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { apiAssetUrl, getNewsArticle, getNewsPage, type NewsArticle } from '../lib/api'
import { useI18n } from '../i18n'
import './NewsScreen.css'

function formatDate(timestamp: number, locale: string) {
  return new Date(timestamp).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })
}

function articleDate(article: NewsArticle) {
  return article.publishedAt || article.createdAt
}

function RichText({ text }: { text: string }) {
  return <div className="news-detail__body">{text.split(/\n{2,}/).map((paragraph, index) => (
    <p key={`${index}-${paragraph.slice(0, 12)}`}>{paragraph.split(/(https?:\/\/[^\s]+)/g).map((part, partIndex) => (
      /^https?:\/\//.test(part)
        ? <a key={partIndex} href={part} target="_blank" rel="noopener noreferrer">{part}</a>
        : part
    ))}</p>
  ))}</div>
}

function NewsDetail({ article, onClose }: { article: NewsArticle; onClose: () => void }) {
  const { t, locale } = useI18n()
  return (
    <article className="news-article">
      <header className="news-topline">
        <button type="button" onClick={onClose} aria-label={t('common.back')}>‹</button>
        <strong>{t('news.title')}</strong>
      </header>
      {article.coverUrl && <img className="news-article__cover" src={apiAssetUrl(article.coverUrl)} alt="" />}
      <div className="news-article__content">
        <span>{article.featured ? t('news.featured') : ''}{formatDate(articleDate(article), locale)}</span>
        <h2>{article.title}</h2>
        {article.summary && <strong>{article.summary}</strong>}
        <RichText text={article.body} />
      </div>
    </article>
  )
}

function NewsCard({ article, index, onOpen }: { article: NewsArticle; index: number; onOpen: () => void }) {
  const { t, locale } = useI18n()
  return <motion.button className={`news-card ${article.featured ? 'is-featured' : ''}`} type="button" onClick={onOpen}
    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 6) * .035 }}>
    {article.coverUrl && <img src={apiAssetUrl(article.coverUrl)} alt="" />}
    <span className="news-card__content">
      <small>{article.featured ? t('news.featured') : ''}{formatDate(articleDate(article), locale)}</small>
      <strong>{article.title}</strong>
      <p>{article.summary || article.body}</p>
      <em>{t('news.read')} <b>›</b></em>
    </span>
  </motion.button>
}

let closeOpenArticle: (() => boolean) | null = null
export function closeNewsArticleIfOpen() {
  return closeOpenArticle?.() ?? false
}

export function NewsScreen({
  initialArticleId,
  onSeen,
  onBack,
}: {
  initialArticleId?: string
  onSeen: (timestamp: number) => void
  onBack: () => void
}) {
  const { t } = useI18n()
  const [news, setNews] = useState<NewsArticle[]>([])
  const [selected, setSelected] = useState<NewsArticle | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')
  const sentinelRef = useRef<HTMLDivElement>(null)
  const openedInitialRef = useRef('')

  useEffect(() => {
    let active = true
    const apply = (result: Awaited<ReturnType<typeof getNewsPage>>) => {
      if (!active) return
      setNews(result.news)
      setHasMore(result.hasMore)
      const latest = Math.max(0, ...result.news.map(articleDate))
      if (latest) onSeen(latest)
    }
    void getNewsPage().then((cached) => {
      apply(cached)
      setLoading(false)
      return getNewsPage(undefined, 20, true)
    }).then(apply).catch((next) => active && setError(next instanceof Error ? next.message : t('news.loadError')))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [onSeen])

  useEffect(() => {
    if (!initialArticleId || openedInitialRef.current === initialArticleId) return
    const local = news.find((article) => article.id === initialArticleId)
    if (local) {
      openedInitialRef.current = initialArticleId
      setSelected(local)
      return
    }
    void getNewsArticle(initialArticleId).then((article) => {
      openedInitialRef.current = initialArticleId
      setSelected(article)
    }).catch(() => undefined)
  }, [initialArticleId, news])

  async function loadOlder() {
    if (loadingOlder || !hasMore || !news.length) return
    setLoadingOlder(true)
    try {
      const before = Math.min(...news.map(articleDate))
      const result = await getNewsPage(before)
      setNews((current) => {
        const merged = new Map(current.map((article) => [article.id, article]))
        for (const article of result.news) merged.set(article.id, article)
        return [...merged.values()].sort((a, b) => articleDate(b) - articleDate(a))
      })
      setHasMore(result.hasMore)
    } finally {
      setLoadingOlder(false)
    }
  }

  useEffect(() => {
    closeOpenArticle = selected
      ? () => {
          setSelected(null)
          return true
        }
      : null
    return () => { closeOpenArticle = null }
  }, [selected])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void loadOlder()
    }, { rootMargin: '180px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  })

  const today = useMemo(() => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    return news.filter((article) => articleDate(article) >= start)
  }, [news])
  const older = useMemo(() => {
    const todayIds = new Set(today.map((article) => article.id))
    return news.filter((article) => !todayIds.has(article.id))
  }, [news, today])

  if (selected) {
    return (
      <div className="news-page">
        <NewsDetail article={selected} onClose={() => setSelected(null)} />
      </div>
    )
  }

  let index = 0
  return <div className="news-page">
    <header className="news-topline">
      <button type="button" onClick={onBack} aria-label={t('common.back')}>‹</button>
      <strong>{t('news.title')}</strong>
    </header>
    {loading && !news.length ? <div className="news-state">{t('news.loading')}</div>
      : error && !news.length ? <div className="news-state is-error">{error}</div>
        : !news.length ? <div className="news-state">{t('news.empty')}</div>
          : <>
            {today.length > 0 && <section className="news-section"><header><small>{t('news.today')}</small><h2>{t('news.todayTitle')}</h2></header>
              <div>{today.map((article) => <NewsCard key={article.id} article={article} index={index++} onOpen={() => setSelected(article)} />)}</div>
            </section>}
            {older.length > 0 && <section className="news-section"><header><small>{t('news.archives')}</small><h2>{t('news.olderTitle')}</h2></header>
              <div>{older.map((article) => <NewsCard key={article.id} article={article} index={index++} onOpen={() => setSelected(article)} />)}</div>
            </section>}
            <div ref={sentinelRef} className="news-sentinel">{loadingOlder ? t('common.loading') : hasMore ? t('news.loadMore') : t('news.allRead')}</div>
          </>}
  </div>
}
