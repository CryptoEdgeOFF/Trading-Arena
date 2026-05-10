import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

const SESSION_KEY = 'btf-comp-session';
const SESSION_USER_KEY = 'btf-comp-user';

function readCachedUser(): SessionUser | null {
  try {
    const raw = window.localStorage.getItem(SESSION_USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

function writeCachedUser(user: SessionUser | null) {
  try {
    if (user) window.localStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
    else window.localStorage.removeItem(SESSION_USER_KEY);
  } catch {
    // ignore
  }
}

interface SessionUser {
  id: string;
  email: string;
  name: string;
  phone?: string | null;
  phoneVerifiedAt?: number | null;
  avatarUrl?: string | null;
  socials?: {
    x?: string;
    instagram?: string;
    discord?: string;
    website?: string;
  };
}

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase() || 'BT';
}

export default function CompetitionSettings() {
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [socials, setSocials] = useState({ x: '', instagram: '', discord: '', website: '' });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const stored = window.localStorage.getItem(SESSION_KEY);
    if (!stored) {
      navigate('/compete');
      return;
    }
    setToken(stored);

    // Hydrate the form from the cached user immediately so the page renders
    // populated even before the backend roundtrip lands.
    const cached = readCachedUser();
    if (cached) {
      setUser(cached);
      setName(cached.name || '');
      setPhone(cached.phone || '');
      setSocials({
        x: cached.socials?.x || '',
        instagram: cached.socials?.instagram || '',
        discord: cached.socials?.discord || '',
        website: cached.socials?.website || '',
      });
    }

    fetch('/api/competition/me', { headers: { Authorization: `Bearer ${stored}` } })
      .then(async (response) => {
        if (!response.ok) throw new Error('Session invalide');
        return response.json();
      })
      .then((data) => {
        const nextUser = data.user as SessionUser;
        setUser(nextUser);
        writeCachedUser(nextUser);
        setName(nextUser.name || '');
        setPhone(nextUser.phone || '');
        setSocials({
          x: nextUser.socials?.x || '',
          instagram: nextUser.socials?.instagram || '',
          discord: nextUser.socials?.discord || '',
          website: nextUser.socials?.website || '',
        });
      })
      .catch(() => {
        window.localStorage.removeItem(SESSION_KEY);
        writeCachedUser(null);
        navigate('/compete');
      });
  }, [navigate]);

  const phoneStatus = useMemo(() => {
    if (!user?.phone) return 'Non renseigne';
    return user.phoneVerifiedAt ? 'Verifie' : 'A reverifier';
  }, [user]);

  async function saveProfile() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/competition/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name, phone, socials }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Modification impossible');
      setUser(data.user);
      writeCachedUser(data.user);
      setMessage('Profil mis a jour');
    } catch (err: any) {
      setError(err.message || 'Erreur inconnue');
    } finally {
      setBusy(false);
    }
  }

  async function uploadAvatar(file: File | null) {
    if (!file) return;
    setUploading(true);
    setError('');
    setMessage('');
    try {
      const form = new FormData();
      form.append('avatar', file);
      const response = await fetch('/api/competition/me/avatar', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Upload impossible');
      setUser(data.user);
      writeCachedUser(data.user);
      setMessage('Photo de profil mise a jour');
    } catch (err: any) {
      setError(err.message || 'Erreur inconnue');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="compete h-screen overflow-y-auto">
      <main className="compete-bg min-h-screen px-5 pb-24 pt-8 md:px-10">
        <div className="mx-auto max-w-4xl">
          <Link to="/compete" className="ghost-cta inline-flex px-4 py-2 text-xs uppercase tracking-[0.14em]">
            Retour arena
          </Link>

          <section className="glass-card mt-6 overflow-hidden p-5 md:p-8">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="micro text-[10px] text-[#dc2626]">Settings</div>
                <h1 className="display mt-2 text-3xl font-bold text-white md:text-5xl">Profil trader</h1>
                <p className="mt-2 text-sm text-[#a1a1aa]">
                  Gere ton pseudo, ta photo, ton telephone et tes reseaux visibles sur BTF Arena.
                </p>
              </div>
              <div className="flex items-center gap-4 rounded-2xl border border-[#232329] bg-black/25 p-4">
                {user?.avatarUrl ? (
                  <img src={user.avatarUrl} alt="" className="h-16 w-16 rounded-2xl object-cover" />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#dc2626] to-[#7f1d1d] text-xl font-bold text-white">
                    {initials(user?.name || name)}
                  </div>
                )}
                <label className="ghost-cta cursor-pointer px-4 py-2 text-xs uppercase tracking-[0.14em]">
                  {uploading ? 'Upload...' : 'Changer photo'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => void uploadAvatar(event.target.files?.[0] || null)}
                    disabled={uploading}
                  />
                </label>
              </div>
            </div>
          </section>

          <section className="mt-5 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="glass-card p-5 md:p-6">
              <h2 className="display text-2xl font-bold text-white">Informations</h2>
              <div className="mt-5 space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs uppercase tracking-[0.18em] text-[#71717a]">Email</label>
                  <input className="input-field opacity-70" value={user?.email || ''} disabled />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs uppercase tracking-[0.18em] text-[#71717a]">Pseudo</label>
                  <input className="input-field" value={name} onChange={(event) => setName(event.target.value)} />
                </div>
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <label className="block text-xs uppercase tracking-[0.18em] text-[#71717a]">Telephone</label>
                    <span className={`text-[10px] uppercase tracking-[0.16em] ${user?.phoneVerifiedAt ? 'text-[#34d399]' : 'text-amber-300'}`}>
                      {phoneStatus}
                    </span>
                  </div>
                  <input className="input-field" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+33 6 12 34 56 78" />
                  <p className="mt-2 text-[11px] text-[#71717a]">
                    Si tu modifies le numero, il devra etre reverifie plus tard pour garder l&apos;anti multi-comptes propre.
                  </p>
                </div>
              </div>
            </div>

            <div className="glass-card p-5 md:p-6">
              <h2 className="display text-2xl font-bold text-white">Reseaux sociaux</h2>
              <div className="mt-5 space-y-4">
                {(['x', 'instagram', 'discord', 'website'] as const).map((key) => (
                  <div key={key}>
                    <label className="mb-1.5 block text-xs uppercase tracking-[0.18em] text-[#71717a]">
                      {key === 'x' ? 'X / Twitter' : key}
                    </label>
                    <input
                      className="input-field"
                      value={socials[key]}
                      onChange={(event) => setSocials((prev) => ({ ...prev, [key]: event.target.value }))}
                      placeholder={key === 'discord' ? 'pseudo#0000' : 'https://...'}
                    />
                  </div>
                ))}
              </div>
            </div>
          </section>

          {(error || message) && (
            <div className={`mt-5 rounded-2xl border px-4 py-3 text-sm ${error ? 'border-[#ef4444]/30 bg-[#ef4444]/10 text-[#fca5a5]' : 'border-[#10b981]/30 bg-[#10b981]/10 text-[#86efac]'}`}>
              {error || message}
            </div>
          )}

          <div className="mt-5 flex justify-end">
            <button type="button" onClick={saveProfile} disabled={busy || !name.trim() || !phone.trim()} className="blood-cta px-6 py-4 text-sm">
              {busy ? 'Sauvegarde...' : 'Sauvegarder'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
