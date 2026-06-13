import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { compressImage } from '../utils/imageUpload';
import { ARENA_ADMIN_PATH } from '../lib/adminPath';

const ADMIN_TOKEN_KEY = 'btf-admin-token';

type PromotionCategory = 'exchange' | 'broker' | 'prop' | 'tool' | 'community';

const CATEGORY_OPTIONS: Array<{ value: PromotionCategory; label: string }> = [
  { value: 'exchange', label: 'Exchange' },
  { value: 'broker', label: 'Broker' },
  { value: 'prop', label: 'Prop firm' },
  { value: 'tool', label: 'Outil / Ressource' },
  { value: 'community', label: 'Communauté' },
];

interface Promotion {
  id: string;
  name: string;
  category: PromotionCategory;
  accent: string;
  tagline: string;
  highlight: string;
  description: string;
  perks: string[];
  promoCode: string;
  referralUrl: string;
  photoUrl: string;
  featured: boolean;
  enabled: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

interface PromotionDraft {
  name: string;
  category: PromotionCategory;
  accent: string;
  tagline: string;
  highlight: string;
  description: string;
  perks: string;
  promoCode: string;
  referralUrl: string;
  photoUrl: string;
  featured: boolean;
  enabled: boolean;
  sortOrder: string;
}

const EMPTY_DRAFT: PromotionDraft = {
  name: '',
  category: 'exchange',
  accent: '#dc2626',
  tagline: '',
  highlight: '',
  description: '',
  perks: '',
  promoCode: '',
  referralUrl: '',
  photoUrl: '',
  featured: false,
  enabled: true,
  sortOrder: '0',
};

function promoToDraft(p: Promotion): PromotionDraft {
  return {
    name: p.name,
    category: p.category,
    accent: p.accent,
    tagline: p.tagline,
    highlight: p.highlight,
    description: p.description,
    perks: p.perks.join('\n'),
    promoCode: p.promoCode,
    referralUrl: p.referralUrl,
    photoUrl: p.photoUrl,
    featured: p.featured,
    enabled: p.enabled,
    sortOrder: String(p.sortOrder ?? 0),
  };
}

function draftToPayload(draft: PromotionDraft) {
  return {
    name: draft.name.trim(),
    category: draft.category,
    accent: draft.accent,
    tagline: draft.tagline.trim(),
    highlight: draft.highlight.trim(),
    description: draft.description.trim(),
    perks: draft.perks
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
    promoCode: draft.promoCode.trim(),
    referralUrl: draft.referralUrl.trim(),
    photoUrl: draft.photoUrl.trim(),
    featured: draft.featured,
    enabled: draft.enabled,
    sortOrder: Number(draft.sortOrder) || 0,
  };
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10px] text-slate-500">{hint}</span>}
    </label>
  );
}

function PhotoUpload({
  photoUrl,
  uploading,
  uploadError,
  onFile,
  onClear,
}: {
  photoUrl: string;
  uploading: boolean;
  uploadError: string;
  onFile: (file: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-start gap-3">
      <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
        {photoUrl ? (
          <img src={photoUrl} alt="" className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-600">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
            </svg>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-200 hover:bg-amber-400/15 disabled:opacity-60"
        >
          {uploading ? 'Upload…' : 'Choisir une photo'}
        </button>
        {photoUrl && (
          <button
            type="button"
            onClick={onClear}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] text-slate-400 hover:border-rose-400 hover:text-rose-300"
          >
            Retirer
          </button>
        )}
        {uploadError && <p className="text-[10px] text-rose-300">{uploadError}</p>}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.currentTarget.value = '';
          }}
        />
      </div>
    </div>
  );
}

function PromotionFormFields({
  draft,
  setDraft,
  onUploadPhoto,
}: {
  draft: PromotionDraft;
  setDraft: (updater: (prev: PromotionDraft) => PromotionDraft) => void;
  onUploadPhoto: (file: File) => Promise<string>;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  async function handleFile(file: File) {
    setUploading(true);
    setUploadError('');
    try {
      const url = await onUploadPhoto(file);
      setDraft((prev) => ({ ...prev, photoUrl: url }));
    } catch (err: any) {
      setUploadError(err.message || 'Upload impossible');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Nom *">
        <input
          value={draft.name}
          onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
          placeholder="Bybit"
          className="admin-input"
        />
      </Field>
      <Field label="Catégorie">
        <select
          value={draft.category}
          onChange={(e) => setDraft((prev) => ({ ...prev, category: e.target.value as PromotionCategory }))}
          className="admin-input"
        >
          {CATEGORY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </Field>

      <Field label="Accroche" hint="1 ligne sous le titre">
        <input
          value={draft.tagline}
          onChange={(e) => setDraft((prev) => ({ ...prev, tagline: e.target.value }))}
          placeholder="Futures, spot et dérivés crypto à frais réduits."
          className="admin-input"
        />
      </Field>
      <Field label="Avantage principal" hint="Badge mis en avant">
        <input
          value={draft.highlight}
          onChange={(e) => setDraft((prev) => ({ ...prev, highlight: e.target.value }))}
          placeholder="Bonus dépôt jusqu’à 30 000 USDT"
          className="admin-input"
        />
      </Field>

      <Field label="Description (optionnel)">
        <textarea
          value={draft.description}
          onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
          rows={2}
          placeholder="Détails supplémentaires…"
          className="admin-input resize-y"
        />
      </Field>
      <Field label="Avantages (1 par ligne)" hint="Liste à puces affichée sur la carte">
        <textarea
          value={draft.perks}
          onChange={(e) => setDraft((prev) => ({ ...prev, perks: e.target.value }))}
          rows={4}
          placeholder={'Réduction sur les frais de futures\nRécompenses de dépôt et de trading\nInterface pro avancée'}
          className="admin-input resize-y"
        />
      </Field>

      <Field label="Code promo (optionnel)">
        <input
          value={draft.promoCode}
          onChange={(e) => setDraft((prev) => ({ ...prev, promoCode: e.target.value }))}
          placeholder="BTFARENA"
          className="admin-input"
        />
      </Field>
      <Field label="Lien d'affiliation (optionnel)" hint="Vide = bouton « Bientôt »">
        <input
          value={draft.referralUrl}
          onChange={(e) => setDraft((prev) => ({ ...prev, referralUrl: e.target.value }))}
          placeholder="https://…"
          className="admin-input"
        />
      </Field>

      <Field label="Photo / logo (optionnel)">
        <PhotoUpload
          photoUrl={draft.photoUrl}
          uploading={uploading}
          uploadError={uploadError}
          onFile={handleFile}
          onClear={() => setDraft((prev) => ({ ...prev, photoUrl: '' }))}
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Couleur d'accent">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={draft.accent}
              onChange={(e) => setDraft((prev) => ({ ...prev, accent: e.target.value }))}
              className="h-9 w-12 cursor-pointer rounded border border-slate-700 bg-slate-950"
            />
            <input
              value={draft.accent}
              onChange={(e) => setDraft((prev) => ({ ...prev, accent: e.target.value }))}
              className="admin-input"
            />
          </div>
        </Field>
        <Field label="Ordre" hint="Petit = en premier">
          <input
            type="number"
            value={draft.sortOrder}
            onChange={(e) => setDraft((prev) => ({ ...prev, sortOrder: e.target.value }))}
            className="admin-input"
          />
        </Field>
      </div>

      <div className="flex items-end gap-6">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={draft.featured}
            onChange={(e) => setDraft((prev) => ({ ...prev, featured: e.target.checked }))}
            className="h-4 w-4 accent-amber-400"
          />
          Mettre en avant
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft((prev) => ({ ...prev, enabled: e.target.checked }))}
            className="h-4 w-4 accent-emerald-400"
          />
          Visible (publié)
        </label>
      </div>
    </div>
  );
}

export default function PromotionsAdmin() {
  const [adminToken, setAdminToken] = useState<string>(() => localStorage.getItem(ADMIN_TOKEN_KEY) || '');
  const [adminCode, setAdminCode] = useState('');
  const [loginError, setLoginError] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(false);
  const [createDraft, setCreateDraft] = useState<PromotionDraft>(EMPTY_DRAFT);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<PromotionDraft | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const adminFetch = useCallback(
    async (url: string, init: RequestInit = {}) => {
      const headers: Record<string, string> = { ...((init.headers as Record<string, string>) || {}) };
      if (adminToken) headers['Authorization'] = `Bearer ${adminToken}`;
      return fetch(url, { ...init, headers });
    },
    [adminToken],
  );

  const fetchPromotions = useCallback(async () => {
    if (!adminToken) return;
    setLoading(true);
    try {
      const res = await adminFetch('/api/admin/promotions');
      if (res.status === 401) {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        setAdminToken('');
        return;
      }
      const data = await res.json();
      setPromotions(data.promotions || []);
    } catch (err: any) {
      setError(err.message || 'Chargement impossible');
    } finally {
      setLoading(false);
    }
  }, [adminFetch, adminToken]);

  useEffect(() => {
    if (!adminToken) return;
    let cancelled = false;
    (async () => {
      const res = await fetch('/api/admin/check', { headers: { Authorization: `Bearer ${adminToken}` } });
      const data = await res.json().catch(() => ({ ok: false }));
      if (cancelled) return;
      if (!data.ok) {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        setAdminToken('');
      } else {
        fetchPromotions();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adminToken, fetchPromotions]);

  async function uploadPhoto(file: File): Promise<string> {
    // Logos détourés : on garde la transparence (WebP avec alpha), pas de fond blanc.
    const compressed = await compressImage(file, { maxSide: 768, quality: 0.85, preserveAlpha: true });
    const formData = new FormData();
    formData.append('image', compressed, file.name.replace(/\.\w+$/, '.webp'));
    const res = await adminFetch('/api/admin/promotion-image', { method: 'POST', body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Upload de la photo impossible');
    return String(data.imageUrl || '');
  }

  async function loginAdmin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: adminCode.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Code admin incorrect');
      }
      const data = await res.json();
      localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
      setAdminToken(data.token);
      setAdminCode('');
    } catch (err: any) {
      setLoginError(err.message);
    }
  }

  async function logoutAdmin() {
    try {
      await adminFetch('/api/admin/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    setAdminToken('');
    setPromotions([]);
  }

  async function createPromotion(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    if (!createDraft.name.trim()) {
      setError('Le nom est requis');
      return;
    }
    setCreating(true);
    try {
      const res = await adminFetch('/api/admin/promotions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftToPayload(createDraft)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Création impossible');
      setInfo('Promotion créée');
      setCreateDraft(EMPTY_DRAFT);
      await fetchPromotions();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function saveEdit(id: string) {
    if (!editDraft) return;
    setError('');
    setInfo('');
    setSavingEdit(true);
    try {
      const res = await adminFetch(`/api/admin/promotions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftToPayload(editDraft)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Mise à jour impossible');
      setInfo('Promotion mise à jour');
      setEditingId(null);
      setEditDraft(null);
      await fetchPromotions();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingEdit(false);
    }
  }

  async function deletePromotion(id: string, name: string) {
    if (!window.confirm(`Supprimer la promotion « ${name} » ?`)) return;
    setError('');
    setInfo('');
    try {
      const res = await adminFetch(`/api/admin/promotions/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Suppression impossible');
      setInfo('Promotion supprimée');
      await fetchPromotions();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function toggleEnabled(promo: Promotion) {
    setError('');
    try {
      const res = await adminFetch(`/api/admin/promotions/${promo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !promo.enabled }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Mise à jour impossible');
      }
      await fetchPromotions();
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (!adminToken) {
    return (
      <div className="h-dvh overflow-y-auto overflow-x-hidden overscroll-y-auto bg-[#020617] text-slate-100">
        <main className="px-4 py-12">
          <div className="mx-auto w-full max-w-md">
            <Link to="/compete" className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-400 hover:text-white">
              <span aria-hidden>←</span> Retour à BTF Arena
            </Link>
            <form onSubmit={loginAdmin} className="rounded-2xl border border-slate-800 bg-slate-900/80 p-7 shadow-2xl">
              <div className="mb-5 flex items-center gap-3">
                <img src="/assets/pictures/logoBTF.webp" alt="BTF" className="h-10 w-10 rounded-lg object-contain" />
                <div>
                  <h1 className="font-rajdhani text-2xl font-bold text-white">Admin Promotions</h1>
                  <p className="text-xs text-slate-400">Deals partenaires — Trade Live Bonus</p>
                </div>
              </div>
              <label className="mb-1 block text-[11px] uppercase tracking-[0.2em] text-slate-500">Code admin</label>
              <input
                type="password"
                value={adminCode}
                onChange={(e) => setAdminCode(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-amber-400"
                placeholder="••••••••"
                autoFocus
              />
              {loginError && <p className="mt-3 text-sm text-rose-400">{loginError}</p>}
              <button
                type="submit"
                className="mt-5 w-full rounded-lg bg-amber-500 px-4 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-black hover:bg-amber-400"
              >
                Connexion
              </button>
            </form>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="h-dvh overflow-y-auto overflow-x-hidden overscroll-y-auto bg-[#020617] text-slate-100">
      <main className="px-4 py-8 pb-16 md:px-8">
        <div className="mx-auto w-full max-w-5xl">
          <header className="mb-8 flex flex-col gap-4 border-b border-slate-800 pb-6 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.2em]">
                <Link to="/compete" className="inline-flex items-center gap-2 text-slate-400 hover:text-white">
                  <span aria-hidden>←</span> BTF Arena
                </Link>
                <Link to={ARENA_ADMIN_PATH} className="text-slate-500 hover:text-amber-200">Admin Arènes</Link>
                <Link to="/compete/bonus" className="text-slate-500 hover:text-amber-200">Voir la page publique ↗</Link>
              </div>
              <h1 className="font-rajdhani text-3xl font-bold text-white">Admin Promotions</h1>
              <p className="text-sm text-slate-400">Gère les deals partenaires affichés sur la page Trade Live Bonus.</p>
            </div>
            <button
              type="button"
              onClick={logoutAdmin}
              className="self-start rounded-lg border border-slate-700 px-4 py-2 text-xs uppercase tracking-[0.2em] text-slate-300 hover:border-rose-400 hover:text-rose-300 md:self-auto"
            >
              Déconnexion
            </button>
          </header>

          {(error || info) && (
            <div className={`mb-6 rounded-xl border px-4 py-3 text-sm ${error ? 'border-rose-500/40 bg-rose-500/10 text-rose-200' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'}`}>
              {error || info}
            </div>
          )}

          {/* Création */}
          <section className="mb-8 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <h2 className="font-rajdhani text-xl font-semibold text-white">Nouvelle promotion</h2>
            <p className="mb-5 text-xs text-slate-400">Lien et code optionnels. Sans lien, la carte affiche « Bientôt ».</p>
            <form onSubmit={createPromotion} className="space-y-5">
              <PromotionFormFields draft={createDraft} setDraft={setCreateDraft} onUploadPhoto={uploadPhoto} />
              <button
                type="submit"
                disabled={creating}
                className="rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold uppercase tracking-[0.18em] text-black hover:bg-amber-400 disabled:opacity-50"
              >
                {creating ? 'Création…' : 'Créer la promotion'}
              </button>
            </form>
          </section>

          {/* Liste */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="font-rajdhani text-xl font-semibold text-white">Promotions ({promotions.length})</h2>
              {loading && <span className="text-xs text-slate-500">Chargement…</span>}
            </div>

            {promotions.length === 0 && !loading ? (
              <p className="rounded-xl border border-dashed border-slate-700 px-4 py-8 text-center text-sm text-slate-500">
                Aucune promotion. Crée la première ci-dessus.
              </p>
            ) : (
              <div className="space-y-3">
                {promotions.map((promo) => (
                  <div key={promo.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                    {editingId === promo.id && editDraft ? (
                      <div className="space-y-5">
                        <PromotionFormFields draft={editDraft} setDraft={(updater) => setEditDraft((prev) => (prev ? updater(prev) : prev))} onUploadPhoto={uploadPhoto} />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => saveEdit(promo.id)}
                            disabled={savingEdit}
                            className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-black hover:bg-emerald-400 disabled:opacity-50"
                          >
                            {savingEdit ? 'Sauvegarde…' : 'Enregistrer'}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setEditingId(null); setEditDraft(null); }}
                            className="rounded-lg border border-slate-700 px-4 py-2 text-xs uppercase tracking-[0.16em] text-slate-300 hover:border-slate-500"
                          >
                            Annuler
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-4">
                        <div
                          className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border"
                          style={{ borderColor: `${promo.accent}66`, backgroundColor: `${promo.accent}1a` }}
                        >
                          {promo.photoUrl ? (
                            <img src={promo.photoUrl} alt="" className="h-full w-full object-contain" />
                          ) : (
                            <span className="text-sm font-bold" style={{ color: promo.accent }}>
                              {promo.name.slice(0, 2).toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-white">{promo.name || '(sans nom)'}</span>
                            <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-slate-400">
                              {CATEGORY_OPTIONS.find((c) => c.value === promo.category)?.label || promo.category}
                            </span>
                            {promo.featured && (
                              <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-amber-200">Mis en avant</span>
                            )}
                            <span className={`rounded-full px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] ${promo.enabled ? 'border border-emerald-400/40 bg-emerald-400/10 text-emerald-200' : 'border border-slate-700 text-slate-500'}`}>
                              {promo.enabled ? 'Publié' : 'Masqué'}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-slate-400">{promo.highlight || promo.tagline || '—'}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => toggleEnabled(promo)}
                            className="rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] text-slate-300 hover:border-slate-500"
                          >
                            {promo.enabled ? 'Masquer' : 'Publier'}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setEditingId(promo.id); setEditDraft(promoToDraft(promo)); }}
                            className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-200 hover:bg-amber-400/15"
                          >
                            Modifier
                          </button>
                          <button
                            type="button"
                            onClick={() => deletePromotion(promo.id, promo.name)}
                            className="rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] text-slate-400 hover:border-rose-400 hover:text-rose-300"
                          >
                            Suppr.
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
