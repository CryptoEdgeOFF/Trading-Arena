import { useRef, useState } from 'react'
import {
  apiAssetUrl,
  joinTeamByCode,
  kickTeamMember,
  leaveTeam,
  uploadTeamImage,
  type ArenaTeam,
  type SessionUser,
} from '../lib/api'
import { useI18n } from '../i18n'
import { ProfileAvatar } from './ProfileAvatar'
import './TeamScreen.css'

async function compressTeamBadge(file: File): Promise<File> {
  const source = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const next = new Image()
      next.onload = () => resolve(next)
      next.onerror = reject
      next.src = source
    })
    const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    return blob ? new File([blob], 'team.jpg', { type: 'image/jpeg' }) : file
  } finally {
    URL.revokeObjectURL(source)
  }
}

export function TeamScreen({
  token,
  user,
  team,
  onChanged,
  onBack,
}: {
  token: string
  user: SessionUser
  team: ArenaTeam | null
  onChanged: (team: ArenaTeam | null) => void
  onBack: () => void
}) {
  const { t } = useI18n()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const badgeInputRef = useRef<HTMLInputElement>(null)

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
    <div className="team-page">
      <header className="subpage-head">
        <button type="button" onClick={onBack} aria-label={t('common.back')}>‹</button>
        <div><span>{t('team.kicker')}</span><h2>{t('team.title')}</h2></div>
      </header>
      <p className="team-lead">{t('team.lead')}</p>

      {!team && (
        <>
          <section className="team-card">
            <strong>{t('team.create')}</strong>
            <p>{t('team.disabledHint')}</p>
          </section>
          <section className="team-card">
            <strong>{t('team.join')}</strong>
            <input value={code} autoCapitalize="characters" placeholder="CODE" onChange={(event) => setCode(event.target.value.toUpperCase())} />
            <button type="button" disabled={busy || code.trim().length < 4} onClick={() => void run(() => joinTeamByCode(token, code.trim()))}>
              {busy ? t('team.saving') : t('team.joinAction')}
            </button>
          </section>
        </>
      )}

      {team && (
        <section className="team-card">
          <div className="team-card__head">
            {team.ownerUserId === user.id ? (
              <button className="team-badge" type="button" disabled={busy} onClick={() => badgeInputRef.current?.click()}>
                {team.imageUrl ? <img src={apiAssetUrl(team.imageUrl)} alt="" /> : <i>{team.name.slice(0, 2).toUpperCase()}</i>}
                <span>{t('team.badgeChange')}</span>
              </button>
            ) : (
              <div className="team-badge is-static">
                {team.imageUrl ? <img src={apiAssetUrl(team.imageUrl)} alt="" /> : <i>{team.name.slice(0, 2).toUpperCase()}</i>}
              </div>
            )}
            <div>
              <strong>{team.name}</strong>
              <small>{team.size}/{team.requiredSize} · {team.isComplete ? t('team.complete') : t('team.incomplete')}</small>
            </div>
            <input
              ref={badgeInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                if (!file.type.startsWith('image/')) {
                  setError(t('team.invalidImage'))
                  return
                }
                void run(async () => uploadTeamImage(token, team.id, await compressTeamBadge(file)))
              }}
            />
          </div>
          <button className="team-code" type="button" onClick={() => {
            void navigator.clipboard?.writeText(team.inviteCode).then(() => {
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1600)
            }).catch(() => undefined)
          }}>
            {t('team.inviteCode')} <b>{team.inviteCode}</b>
            <span>{copied ? t('team.copied') : t('team.copy')}</span>
          </button>
          <p>{t('team.inviteHint')}</p>
          <div className="team-members">
            {team.members.map((member) => (
              <article key={member.userId}>
                <ProfileAvatar avatarUrl={member.avatarUrl} name={member.name} size="sm" />
                <div>
                  <strong>{member.name}</strong>
                  <small>{member.isOwner ? t('team.owner') : t('team.member')}</small>
                </div>
                {team.ownerUserId === user.id && !member.isOwner && !team.locked && (
                  <button type="button" disabled={busy} onClick={() => void run(() => kickTeamMember(token, team.id, member.userId))}>
                    {t('team.kick')}
                  </button>
                )}
              </article>
            ))}
          </div>
          {team.locked && <p>{t('team.locked')}</p>}
          {!team.locked && (
            <button className="is-ghost" type="button" disabled={busy} onClick={() => void run(() => leaveTeam(token, team.id))}>
              {team.ownerUserId === user.id ? t('team.disband') : t('team.leave')}
            </button>
          )}
        </section>
      )}

      {error && <p className="team-error">{error}</p>}
    </div>
  )
}
