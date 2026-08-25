import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ARENA_ADMIN_PATH } from '../lib/adminPath';
import { compressImage } from '../utils/imageUpload';
import './NewsAdmin.css';

const ADMIN_TOKEN_KEY = 'btf-admin-token';

interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  body: string;
  titleEn?: string;
  summaryEn?: string;
  bodyEn?: string;
  coverUrl: string;
  published: boolean;
  featured: boolean;
  publishedAt: number | null;
  pushSentAt: number | null;
  createdAt: number;
  updatedAt: number;
}

interface NewsDraft {
  title: string;
  summary: string;
  body: string;
  titleEn: string;
  summaryEn: string;
  bodyEn: string;
  coverUrl: string;
  published: boolean;
  featured: boolean;
  notify: boolean;
}

const EMPTY_DRAFT: NewsDraft = {
  title: '',
  summary: '',
  body: '',
  titleEn: '',
  summaryEn: '',
  bodyEn: '',
  coverUrl: '',
  published: false,
  featured: false,
  notify: false,
};

function toDraft(article: NewsArticle): NewsDraft {
  return {
    title: article.title,
    summary: article.summary,
    body: article.body,
    titleEn: article.titleEn || '',
    summaryEn: article.summaryEn || '',
    bodyEn: article.bodyEn || '',
    coverUrl: article.coverUrl,
    published: article.published,
    featured: article.featured,
    notify: false,
  };
}

function NewsFields({
  draft,
  setDraft,
  upload,
}: {
  draft: NewsDraft;
  setDraft: (updater: (current: NewsDraft) => NewsDraft) => void;
  upload: (file: File) => Promise<string>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function choose(file: File) {
    setUploading(true);
    try {
      const coverUrl = await upload(file);
      setDraft((current) => ({ ...current, coverUrl }));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="grid gap-5">
      <label>
        <span className="news-admin-label">Titre *</span>
        <input className="admin-input" maxLength={180} value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Titre de l’actualité" />
      </label>
      <label>
        <span className="news-admin-label">Résumé</span>
        <textarea className="admin-input min-h-20" maxLength={420} value={draft.summary} onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))} placeholder="Texte affiché sur la carte mobile" />
      </label>
      <label>
        <span className="news-admin-label">Contenu *</span>
        <textarea className="admin-input min-h-64" maxLength={30000} value={draft.body} onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))} placeholder={'Rédige l’annonce ici.\n\nLes paragraphes et les liens https://… seront conservés.'} />
      </label>
      <label>
        <span className="news-admin-label">Title EN</span>
        <input className="admin-input" maxLength={180} value={draft.titleEn} onChange={(event) => setDraft((current) => ({ ...current, titleEn: event.target.value }))} placeholder="English title" />
      </label>
      <label>
        <span className="news-admin-label">Summary EN</span>
        <textarea className="admin-input min-h-20" maxLength={420} value={draft.summaryEn} onChange={(event) => setDraft((current) => ({ ...current, summaryEn: event.target.value }))} placeholder="English card text" />
      </label>
      <label>
        <span className="news-admin-label">Content EN</span>
        <textarea className="admin-input min-h-64" maxLength={30000} value={draft.bodyEn} onChange={(event) => setDraft((current) => ({ ...current, bodyEn: event.target.value }))} placeholder="English article body" />
      </label>
      <div>
        <span className="news-admin-label">Image de couverture</span>
        <div className="flex flex-wrap items-center gap-4">
          <div className="news-admin-cover">
            {draft.coverUrl ? <img src={draft.coverUrl} alt="" /> : <span>Aucune image</span>}
          </div>
          <div className="grid gap-2">
            <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()} className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-xs font-semibold text-amber-200">
              {uploading ? 'Upload…' : 'Choisir une image'}
            </button>
            {draft.coverUrl && <button type="button" className="text-xs text-slate-500 hover:text-rose-300" onClick={() => setDraft((current) => ({ ...current, coverUrl: '' }))}>Retirer l’image</button>}
            <input ref={fileRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void choose(file);
              event.currentTarget.value = '';
            }} />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-6">
        <label className="news-admin-check"><input type="checkbox" checked={draft.featured} onChange={(event) => setDraft((current) => ({ ...current, featured: event.target.checked }))} /> Mettre en avant</label>
        <label className="news-admin-check"><input type="checkbox" checked={draft.published} onChange={(event) => setDraft((current) => ({ ...current, published: event.target.checked, notify: event.target.checked ? current.notify : false }))} /> Publier</label>
        {draft.published && <label className="news-admin-check is-notify"><input type="checkbox" checked={draft.notify} onChange={(event) => setDraft((current) => ({ ...current, notify: event.target.checked }))} /> Envoyer une notification push</label>}
      </div>
    </div>
  );
}

export default function NewsAdmin() {
  const [token, setToken] = useState(() => localStorage.getItem(ADMIN_TOKEN_KEY) || '');
  const [code, setCode] = useState('');
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [draft, setDraft] = useState<NewsDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<NewsDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const adminFetch = useCallback((url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    const response = await adminFetch('/api/admin/news');
    if (response.status === 401) {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      setToken('');
      return;
    }
    const data = await response.json();
    setArticles(data.news || []);
  }, [adminFetch, token]);

  useEffect(() => { void load().catch((next) => setError(next.message)); }, [load]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setError('');
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.trim() }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data.error || 'Code admin incorrect');
      return;
    }
    localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
    setToken(data.token);
    setCode('');
  }

  async function upload(file: File): Promise<string> {
    const compressed = await compressImage(file, { maxSide: 1800, quality: 0.86 });
    const form = new FormData();
    form.append('image', compressed, file.name.replace(/\.\w+$/, '.webp'));
    const response = await adminFetch('/api/admin/news-cover', { method: 'POST', body: form });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Upload impossible');
    return data.imageUrl;
  }

  async function saveArticle(current: NewsDraft, id?: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await adminFetch(id ? `/api/admin/news/${id}` : '/api/admin/news', {
        method: id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: current.title,
          summary: current.summary,
          body: current.body,
          titleEn: current.titleEn,
          summaryEn: current.summaryEn,
          bodyEn: current.bodyEn,
          coverUrl: current.coverUrl,
          featured: current.featured,
          published: false,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Enregistrement impossible');
      let article = data.article as NewsArticle;
      if (current.published) {
        const publishResponse = await adminFetch(`/api/admin/news/${article.id}/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notify: current.notify }),
        });
        const published = await publishResponse.json().catch(() => ({}));
        if (!publishResponse.ok) throw new Error(published.error || 'Publication impossible');
        article = published.article;
      }
      setMessage(current.published ? `Actualité publiée${current.notify && article.pushSentAt ? ' et notification envoyée' : ''}.` : 'Brouillon enregistré.');
      setDraft(EMPTY_DRAFT);
      setEditingId(null);
      setEditDraft(null);
      await load();
    } catch (next) {
      setError(next instanceof Error ? next.message : 'Enregistrement impossible');
    } finally {
      setBusy(false);
    }
  }

  async function remove(article: NewsArticle) {
    if (!window.confirm(`Supprimer « ${article.title} » ?`)) return;
    const response = await adminFetch(`/api/admin/news/${article.id}`, { method: 'DELETE' });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error || 'Suppression impossible');
      return;
    }
    await load();
  }

  if (!token) {
    return <main className="news-admin-shell">
      <form className="news-admin-login" onSubmit={login}>
        <img src="/assets/pictures/logoBTF.webp" alt="BTF" />
        <h1>Admin Actualités</h1>
        <p>Publie les annonces visibles dans l’application mobile.</p>
        <input className="admin-input" type="password" value={code} onChange={(event) => setCode(event.target.value)} placeholder="Code admin" autoFocus />
        {error && <span className="text-sm text-rose-300">{error}</span>}
        <button type="submit">Connexion</button>
      </form>
    </main>;
  }

  return <main className="news-admin-shell">
    <div className="news-admin-page">
      <header className="news-admin-head">
        <div>
          <nav><Link to="/compete">BTF Arena</Link><Link to={ARENA_ADMIN_PATH}>Admin Arènes</Link></nav>
          <h1>Actualités mobiles</h1>
          <p>News du jour, informations et annonces officielles.</p>
        </div>
        <button type="button" onClick={() => {
          localStorage.removeItem(ADMIN_TOKEN_KEY);
          setToken('');
        }}>Déconnexion</button>
      </header>

      {(message || error) && <div className={error ? 'news-admin-feedback is-error' : 'news-admin-feedback'}>{error || message}</div>}

      <section className="news-admin-panel">
        <h2>Nouvelle actualité</h2>
        <NewsFields draft={draft} setDraft={setDraft} upload={upload} />
        <button className="news-admin-save" type="button" disabled={busy} onClick={() => void saveArticle(draft)}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
      </section>

      <section className="news-admin-panel">
        <h2>Actualités ({articles.length})</h2>
        <div className="grid gap-3">
          {articles.map((article) => <article className="news-admin-item" key={article.id}>
            {editingId === article.id && editDraft ? <div className="grid gap-5">
              <NewsFields draft={editDraft} setDraft={(updater) => setEditDraft((current) => current ? updater(current) : current)} upload={upload} />
              <div className="flex gap-2">
                <button className="news-admin-save" disabled={busy} onClick={() => void saveArticle(editDraft, article.id)}>Enregistrer</button>
                <button className="news-admin-cancel" onClick={() => { setEditingId(null); setEditDraft(null); }}>Annuler</button>
              </div>
            </div> : <>
              {article.coverUrl && <img src={article.coverUrl} alt="" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-2">
                  <strong>{article.title}</strong>
                  <span className={article.published ? 'is-live' : ''}>{article.published ? 'Publié' : 'Brouillon'}</span>
                  {article.featured && <span>À la une</span>}
                  {article.pushSentAt && <span>Push envoyé</span>}
                </div>
                <p>{article.summary || article.body}</p>
                <small>{new Date(article.publishedAt || article.createdAt).toLocaleString('fr-FR')}</small>
              </div>
              <div className="news-admin-actions">
                <button onClick={() => { setEditingId(article.id); setEditDraft(toDraft(article)); }}>Modifier</button>
                <button onClick={() => void remove(article)}>Supprimer</button>
              </div>
            </>}
          </article>)}
          {!articles.length && <p className="py-8 text-center text-sm text-slate-500">Aucune actualité.</p>}
        </div>
      </section>
    </div>
  </main>;
}
