import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { resolveMediaUrl } from '../utils/imageUrl'

export type ArenaTeam = {
  id: string
  name: string
  inviteCode: string
  ownerUserId: string
  createdAt: number
  size: number
  requiredSize: number
  isComplete: boolean
  locked: boolean
  imageUrl?: string | null
  members: Array<{
    userId: string
    name: string
    avatarUrl: string | null
    joinedAt: number
    isOwner: boolean
  }>
}

async function teamRequest<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Erreur API')
  return data as T
}

export function TeamPanel({
  token,
  userId,
  team,
  onChanged,
}: {
  token: string
  userId: string
  team: ArenaTeam | null
  onChanged: (team: ArenaTeam | null) => void
}) {
  const { t } = useTranslation()
  const fileRef = useRef<HTMLInputElement>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  async function run(action: () => Promise<ArenaTeam | null>) {
    setBusy(true)
    setError('')
    try {
      onChanged(await action())
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('team.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="glass-card overflow-hidden p-5 sm:p-6">
      <div className="micro text-[10px] text-[#c9b6ff]">{t('team.kicker')}</div>
      <h2 className="display mt-1 text-2xl font-black uppercase text-white">{t('team.title')}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#8b858e]">{t('team.lead')}</p>

      {!team && (
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
            <strong className="display block text-lg uppercase text-white">{t('team.create')}</strong>
            <p className="mt-3 text-sm leading-relaxed text-[#8b858e]">{t('team.disabledHint')}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
            <strong className="display block text-lg uppercase text-white">{t('team.join')}</strong>
            <input
              value={code}
              maxLength={12}
              placeholder="CODE"
              autoCapitalize="characters"
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              className="input-field mt-3 tracking-[0.18em]"
            />
            <button
              type="button"
              disabled={busy || code.trim().length < 4}
              onClick={() => void run(async () => {
                const data = await teamRequest<{ team: ArenaTeam }>('/api/competition/teams/join', token, {
                  method: 'POST',
                  body: JSON.stringify({ code: code.trim() }),
                })
                return data.team
              })}
              className="ghost-cta mt-3 w-full px-4 py-3 text-sm disabled:opacity-45"
            >
              {busy ? t('team.saving') : t('team.joinAction')}
            </button>
          </div>
        </div>
      )}

      {team && (
        <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4">
          <div className="flex flex-wrap items-center gap-4">
            {team.ownerUserId === userId ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                className="relative h-16 w-16 overflow-hidden rounded-2xl border border-[#a88bff]/40 bg-[#2b1d4a]"
              >
                {team.imageUrl
                  ? <img src={resolveMediaUrl(team.imageUrl)} alt="" className="h-full w-full object-cover" />
                  : <span className="display grid h-full place-items-center text-xl text-white">{team.name.slice(0, 2).toUpperCase()}</span>}
                <span className="absolute inset-x-0 bottom-0 bg-black/70 py-0.5 text-[8px] font-black uppercase tracking-wider text-white">{t('team.badgeChange')}</span>
              </button>
            ) : (
              <div className="h-16 w-16 overflow-hidden rounded-2xl border border-[#a88bff]/40 bg-[#2b1d4a]">
                {team.imageUrl
                  ? <img src={resolveMediaUrl(team.imageUrl)} alt="" className="h-full w-full object-cover" />
                  : <span className="display grid h-full place-items-center text-xl text-white">{team.name.slice(0, 2).toUpperCase()}</span>}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <strong className="display text-2xl uppercase text-white">{team.name}</strong>
              <p className="mt-1 text-xs text-[#8b858e]">
                {team.size}/{team.requiredSize} · {team.isComplete ? t('team.complete') : t('team.incomplete')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(team.inviteCode).then(() => {
                  setCopied(true)
                  window.setTimeout(() => setCopied(false), 1600)
                }).catch(() => undefined)
              }}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left"
            >
              <small className="block text-[9px] font-bold uppercase tracking-[0.14em] text-[#8b858e]">{t('team.inviteCode')}</small>
              <b className="num tracking-[0.16em] text-white">{team.inviteCode}</b>
              <span className="ml-2 text-[10px] uppercase text-[#c9b6ff]">{copied ? t('team.copied') : t('team.copy')}</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                void run(async () => {
                  const form = new FormData()
                  form.append('image', file, file.name || 'team.jpg')
                  const data = await teamRequest<{ team: ArenaTeam }>(`/api/competition/teams/${encodeURIComponent(team.id)}/image`, token, {
                    method: 'POST',
                    body: form,
                    headers: { Authorization: `Bearer ${token}` },
                  })
                  return data.team
                })
              }}
            />
          </div>
          <p className="mt-3 text-xs text-[#8b858e]">{t('team.inviteHint')}</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {team.members.map((member) => (
              <article key={member.userId} className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                {member.avatarUrl
                  ? <img src={resolveMediaUrl(member.avatarUrl)} alt="" className="h-9 w-9 rounded-full object-cover" />
                  : <span className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-[10px] font-black text-white">{member.name.slice(0, 2).toUpperCase()}</span>}
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-sm text-white">{member.name}</strong>
                  <small className="text-[10px] uppercase tracking-wider text-[#8b858e]">{member.isOwner ? t('team.owner') : t('team.member')}</small>
                </div>
                {team.ownerUserId === userId && !member.isOwner && !team.locked && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(async () => {
                      const data = await teamRequest<{ team: ArenaTeam }>(`/api/competition/teams/${encodeURIComponent(team.id)}/kick`, token, {
                        method: 'POST',
                        body: JSON.stringify({ userId: member.userId }),
                      })
                      return data.team
                    })}
                    className="text-[10px] font-black uppercase tracking-wider text-[#ff91a0]"
                  >
                    {t('team.kick')}
                  </button>
                )}
              </article>
            ))}
          </div>
          {team.locked && <p className="mt-3 text-xs text-[#c9b6ff]">{t('team.locked')}</p>}
          {!team.locked && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(async () => {
                const data = await teamRequest<{ team: ArenaTeam | null }>(`/api/competition/teams/${encodeURIComponent(team.id)}/leave`, token, {
                  method: 'POST',
                })
                return data.team || null
              })}
              className="ghost-cta mt-4 px-4 py-2.5 text-xs"
            >
              {team.ownerUserId === userId ? t('team.disband') : t('team.leave')}
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-[#dc2626]/30 bg-[#dc2626]/10 px-3 py-2 text-sm text-[#ff91a0]">{error}</p>
      )}
    </section>
  )
}
