import { useCallback, useEffect, useMemo, useState } from 'react';

type EmailKind =
  | 'otp'
  | 'new_arena'
  | 'prize_winner'
  | 'arena_start_soon'
  | 'arena_podium_lost'
  | 'arena_results';

type EmailMode = 'on' | 'off' | 'test';

type EmailStatus = 'sent' | 'test' | 'blocked' | 'failed' | 'no-smtp';

interface EmailFieldDef {
  key: string;
  label: string;
  multiline?: boolean;
  default: string;
  vars?: string;
}

interface EmailKindMeta {
  kind: EmailKind;
  label: string;
  description: string;
  fields: EmailFieldDef[];
}

interface EmailKindSetting {
  mode: EmailMode;
  overrides: Record<string, string>;
}

interface EmailSettings {
  globalTest: boolean;
  testRedirect: string;
  kinds: Record<EmailKind, EmailKindSetting>;
  updatedAt: number;
}

interface EmailLogEntry {
  id: string;
  at: number;
  kind: EmailKind;
  to: string;
  subject: string;
  status: EmailStatus;
  redirectedTo?: string;
  error?: string;
}

const MODE_META: Record<EmailMode, { label: string; cls: string }> = {
  on: { label: 'Actif', cls: 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200' },
  test: { label: 'Test', cls: 'border-amber-500/50 bg-amber-500/15 text-amber-200' },
  off: { label: 'Bloqué', cls: 'border-rose-500/50 bg-rose-500/15 text-rose-200' },
};

const STATUS_META: Record<EmailStatus, { label: string; cls: string }> = {
  sent: { label: 'Envoyé', cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' },
  test: { label: 'Test', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-200' },
  blocked: { label: 'Bloqué', cls: 'border-rose-500/40 bg-rose-500/10 text-rose-200' },
  failed: { label: 'Échec', cls: 'border-rose-500/40 bg-rose-500/10 text-rose-200' },
  'no-smtp': { label: 'Sans SMTP', cls: 'border-slate-600 bg-slate-800 text-slate-300' },
};

function fmtTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(ts);
  }
}

type AdminFetch = (url: string, init?: RequestInit) => Promise<Response>;

export default function EmailAdminPanel({ adminFetch }: { adminFetch: AdminFetch }) {
  const [catalog, setCatalog] = useState<EmailKindMeta[]>([]);
  const [settings, setSettings] = useState<EmailSettings | null>(null);
  const [draft, setDraft] = useState<EmailSettings | null>(null);
  const [log, setLog] = useState<EmailLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [expanded, setExpanded] = useState<EmailKind | null>(null);
  const [testTargets, setTestTargets] = useState<Record<string, string>>({});
  const [sendingTest, setSendingTest] = useState<EmailKind | null>(null);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch('/api/admin/emails/config');
      if (!res.ok) throw new Error('Chargement impossible');
      const data = await res.json();
      setCatalog(data.catalog || []);
      setSettings(data.settings || null);
      setDraft(data.settings || null);
    } catch (err) {
      setMsg({ kind: 'err', text: (err as Error)?.message || 'Erreur' });
    } finally {
      setLoading(false);
    }
  }, [adminFetch]);

  const loadLog = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/emails/log?limit=150');
      if (!res.ok) return;
      const data = await res.json();
      setLog(Array.isArray(data.entries) ? data.entries : []);
    } catch {
      // informatif seulement
    }
  }, [adminFetch]);

  useEffect(() => {
    loadConfig();
    loadLog();
  }, [loadConfig, loadLog]);

  useEffect(() => {
    const timer = window.setInterval(loadLog, 20_000);
    return () => window.clearInterval(timer);
  }, [loadLog]);

  const dirty = useMemo(
    () => JSON.stringify(settings) !== JSON.stringify(draft),
    [settings, draft],
  );

  function patchKind(kind: EmailKind, patch: Partial<EmailKindSetting>) {
    setDraft((d) => {
      if (!d) return d;
      return { ...d, kinds: { ...d.kinds, [kind]: { ...d.kinds[kind], ...patch } } };
    });
  }

  function setOverride(kind: EmailKind, key: string, value: string) {
    setDraft((d) => {
      if (!d) return d;
      const cur = d.kinds[kind];
      const overrides = { ...cur.overrides, [key]: value };
      return { ...d, kinds: { ...d.kinds, [kind]: { ...cur, overrides } } };
    });
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await adminFetch('/api/admin/emails/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          globalTest: draft.globalTest,
          testRedirect: draft.testRedirect,
          kinds: draft.kinds,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Enregistrement impossible');
      setSettings(data.settings);
      setDraft(data.settings);
      setMsg({ kind: 'ok', text: 'Paramètres enregistrés.' });
    } catch (err) {
      setMsg({ kind: 'err', text: (err as Error)?.message || 'Erreur' });
    } finally {
      setSaving(false);
    }
  }

  async function sendTest(kind: EmailKind) {
    const to = (testTargets[kind] || draft?.testRedirect || '').trim();
    if (!to) {
      setMsg({ kind: 'err', text: 'Indique une adresse de destination pour le test.' });
      return;
    }
    setSendingTest(kind);
    setMsg(null);
    try {
      const res = await adminFetch('/api/admin/emails/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, to }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Envoi impossible');
      setMsg({
        kind: data.ok ? 'ok' : 'err',
        text: data.ok ? `Email de test envoyé à ${to}.` : `Non envoyé : ${data.result?.error || 'erreur'}`,
      });
      loadLog();
    } catch (err) {
      setMsg({ kind: 'err', text: (err as Error)?.message || 'Erreur' });
    } finally {
      setSendingTest(null);
    }
  }

  const sentCount = log.filter((e) => e.status === 'sent').length;
  const failedCount = log.filter((e) => e.status === 'failed' || e.status === 'no-smtp').length;

  return (
    <section className="mb-8 rounded-2xl border border-sky-400/20 bg-slate-900/60 p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">Emails — suivi & configuration</h2>
          <p className="text-sm text-slate-400">
            Active, bloque ou bascule en test chaque type d'email, édite les textes, et suis les derniers envois.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { loadConfig(); loadLog(); }}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700"
          >
            Rafraîchir
          </button>
        </div>
      </div>

      {msg && (
        <div
          className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
            msg.kind === 'ok'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
              : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* Paramètres globaux */}
      {draft && (
        <div className="mb-6 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={draft.globalTest}
                onChange={(e) => setDraft({ ...draft, globalTest: e.target.checked })}
                className="h-4 w-4 accent-amber-500"
              />
              Mode test global (tous les emails redirigés)
            </label>
            <div className="flex-1 min-w-[220px]">
              <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
                Adresse de redirection (test)
              </label>
              <input
                type="email"
                value={draft.testRedirect}
                onChange={(e) => setDraft({ ...draft, testRedirect: e.target.value })}
                placeholder="test@exemple.com"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
              />
            </div>
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-40"
            >
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
          {dirty && (
            <p className="mt-2 text-xs text-amber-300">Modifications non enregistrées.</p>
          )}
        </div>
      )}

      {/* Types d'emails */}
      <div className="space-y-3">
        {draft &&
          catalog.map((meta) => {
            const ks = draft.kinds[meta.kind];
            if (!ks) return null;
            const isOpen = expanded === meta.kind;
            return (
              <div key={meta.kind} className="rounded-xl border border-slate-800 bg-slate-950/40">
                <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-[200px] flex-1">
                    <div className="font-semibold text-white">{meta.label}</div>
                    <div className="text-xs text-slate-400">{meta.description}</div>
                  </div>
                  <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 p-1">
                    {(['on', 'test', 'off'] as EmailMode[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => patchKind(meta.kind, { mode: m })}
                        className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                          ks.mode === m
                            ? MODE_META[m].cls + ' border'
                            : 'border border-transparent text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {MODE_META[m].label}
                      </button>
                    ))}
                  </div>
                  {meta.fields.length > 0 && (
                    <button
                      onClick={() => setExpanded(isOpen ? null : meta.kind)}
                      className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
                    >
                      {isOpen ? 'Masquer le texte' : 'Modifier le texte'}
                    </button>
                  )}
                </div>

                {isOpen && meta.fields.length > 0 && (
                  <div className="space-y-3 border-t border-slate-800 p-4">
                    {meta.fields.map((field) => (
                      <div key={field.key}>
                        <div className="mb-1 flex items-center justify-between">
                          <label className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                            {field.label}
                          </label>
                          {field.vars && (
                            <span className="text-[10px] text-slate-500">variables : {field.vars}</span>
                          )}
                        </div>
                        {field.multiline ? (
                          <textarea
                            value={ks.overrides[field.key] ?? field.default}
                            onChange={(e) => setOverride(meta.kind, field.key, e.target.value)}
                            rows={2}
                            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                          />
                        ) : (
                          <input
                            type="text"
                            value={ks.overrides[field.key] ?? field.default}
                            onChange={(e) => setOverride(meta.kind, field.key, e.target.value)}
                            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                          />
                        )}
                        <button
                          onClick={() => setOverride(meta.kind, field.key, field.default)}
                          className="mt-1 text-[11px] text-slate-500 hover:text-slate-300"
                        >
                          Réinitialiser
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 p-3">
                  <input
                    type="email"
                    value={testTargets[meta.kind] ?? ''}
                    onChange={(e) => setTestTargets((t) => ({ ...t, [meta.kind]: e.target.value }))}
                    placeholder={draft.testRedirect || 'destinataire@test.com'}
                    className="flex-1 min-w-[180px] rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white"
                  />
                  <button
                    onClick={() => sendTest(meta.kind)}
                    disabled={sendingTest === meta.kind}
                    className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/20 disabled:opacity-40"
                  >
                    {sendingTest === meta.kind ? 'Envoi…' : 'Envoyer un test'}
                  </button>
                </div>
              </div>
            );
          })}
      </div>

      {/* Journal des envois */}
      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">Derniers envois</h3>
          <span className="text-xs text-slate-400">
            {log.length} entrées · {sentCount} envoyés · {failedCount} en échec
          </span>
        </div>
        <div className="max-h-80 overflow-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-900 text-slate-400">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Destinataire</th>
                <th className="px-3 py-2 font-medium">Sujet</th>
                <th className="px-3 py-2 font-medium">Statut</th>
              </tr>
            </thead>
            <tbody>
              {log.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                    {loading ? 'Chargement…' : 'Aucun email envoyé pour le moment.'}
                  </td>
                </tr>
              )}
              {log.map((e) => {
                const s = STATUS_META[e.status] || STATUS_META.sent;
                const meta = catalog.find((m) => m.kind === e.kind);
                return (
                  <tr key={e.id} className="border-t border-slate-800/70 text-slate-200">
                    <td className="whitespace-nowrap px-3 py-2 text-slate-400">{fmtTime(e.at)}</td>
                    <td className="px-3 py-2">{meta?.label || e.kind}</td>
                    <td className="px-3 py-2">
                      {e.to}
                      {e.redirectedTo && (
                        <span className="block text-[10px] text-amber-300/80">→ {e.redirectedTo}</span>
                      )}
                    </td>
                    <td className="max-w-[260px] truncate px-3 py-2" title={e.subject}>{e.subject}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block rounded-md border px-2 py-0.5 text-[10px] font-semibold ${s.cls}`}>
                        {s.label}
                      </span>
                      {e.error && <span className="block text-[10px] text-rose-300/80" title={e.error}>{e.error}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
