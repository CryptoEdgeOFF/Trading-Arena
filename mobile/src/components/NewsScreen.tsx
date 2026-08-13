import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { apiAssetUrl, getNewsArticle, getNewsPage, type NewsArticle } from '../lib/api'
import './NewsScreen.css'

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
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
  return <div className="news-detail-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <motion.article className="news-detail" role="dialog" aria-modal="true" aria-label={article.title}
      initial={{ opacity: 0, y: 35 }} animate={{ opacity: 1, y: 0 }}>
      <button className="news-detail__close" type="button" onClick={onClose} aria-label="Fermer">×</button>
      {article.coverUrl && <img className="news-detail__cover" src={apiAssetUrl(article.coverUrl)} alt="" />}
      <div className="news-detail__content">
        <span>{article.featured ? 'À LA UNE · ' : ''}{formatDate(articleDate(article))}</span>
        <h2>{article.title}</h2>
        {article.summary && <strong>{article.summary}</strong>}
        <RichText text={article.body} />
      </div>
    </motion.article>
  </div>
}

function NewsCard({ article, index, onOpen }: { article: NewsArticle; index: number; onOpen: () => void }) {
  return <motion.button className={`news-card ${article.featured ? 'is-featured' : ''}`} type="button" onClick={onOpen}
    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 6) * .035 }}>
    {article.coverUrl && <img src={apiAssetUrl(article.coverUrl)} alt="" />}
    <span className="news-card__content">
      <small>{article.featured ? 'À LA UNE · ' : ''}{formatDate(articleDate(article))}</small>
      <strong>{article.title}</strong>
      <p>{article.summary || article.body}</p>
      <em>Lire l’article <b>›</b></em>
    </span>
  </motion.button>
}

export function NewsScreen({
  initialArticleId,
  onSeen,
}: {
  initialArticleId?: string
  onSeen: (timestamp: number) => void
}) {
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
    }).then(apply).catch((next) => active && setError(next instanceof Error ? next.message : 'Chargement impossible'))
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

  let index = 0
  return <div className="news-page">
    <header className="news-hero">
      <span>LE FIL BTF</span>
      <h1>Actualités</h1>
      <p>News du jour, annonces officielles et informations de la communauté.</p>
    </header>
    {loading && !news.length ? <div className="news-state">Chargement des actualités…</div>
      : error && !news.length ? <div className="news-state is-error">{error}</div>
        : !news.length ? <div className="news-state">Aucune actualité publiée pour le moment.</div>
          : <>
            {today.length > 0 && <section className="news-section"><header><small>AUJOURD’HUI</small><h2>Les news du jour</h2></header>
              <div>{today.map((article) => <NewsCard key={article.id} article={article} index={index++} onOpen={() => setSelected(article)} />)}</div>
            </section>}
            {older.length > 0 && <section className="news-section"><header><small>ARCHIVES</small><h2>Actualités précédentes</h2></header>
              <div>{older.map((article) => <NewsCard key={article.id} article={article} index={index++} onOpen={() => setSelected(article)} />)}</div>
            </section>}
            <div ref={sentinelRef} className="news-sentinel">{loadingOlder ? 'Chargement…' : hasMore ? 'Voir plus' : 'Tu as tout lu'}</div>
          </>}
    {selected && <NewsDetail article={selected} onClose={() => setSelected(null)} />}
  </div>
}
