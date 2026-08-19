import { useRef, useState } from 'react'
import {
  apiAssetUrl,
  deleteUserAccount,
  updateUserProfile,
  uploadUserAvatar,
  type SessionUser,
} from '../lib/api'
import { LanguageSwitcher } from './LanguageSwitcher'
import { useI18n } from '../i18n'
import './ProfileSettings.css'

async function compressAvatar(file: File): Promise<File> {
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
    return blob ? new File([blob], 'avatar.jpg', { type: 'image/jpeg' }) : file
  } finally {
    URL.revokeObjectURL(source)
  }
}

export function ProfileSettings({
  token,
  user,
  onUpdated,
  onDeleted,
  onBack,
}: {
  token: string
  user: SessionUser
  onUpdated: (user: SessionUser) => void
  onDeleted: () => void
  onBack: () => void
}) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(user.name)
  const phone = user.phone || ''
  const [socials, setSocials] = useState({
    x: user.socials?.x || '',
    instagram: user.socials?.instagram || '',
    discord: user.socials?.discord || '',
    website: user.socials?.website || '',
  })
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl || '')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function save() {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const nextUser = await updateUserProfile(token, { name, phone, socials })
      onUpdated(nextUser)
      setMessage(t('settings.saved'))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('settings.saveError'))
    } finally {
      setBusy(false)
    }
  }

  async function upload(file?: File) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError(t('settings.invalidImage'))
      return
    }
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const compressed = await compressAvatar(file)
      const nextUser = await uploadUserAvatar(token, compressed)
      setAvatarUrl(nextUser.avatarUrl || '')
      onUpdated(nextUser)
      setMessage(t('settings.photoSaved'))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('settings.uploadError'))
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function removeAccount() {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await deleteUserAccount(token)
      onDeleted()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('settings.deleteError'))
      setBusy(false)
    }
  }

  return (
    <div className="settings-page">
      <header className="subpage-head">
        <button type="button" onClick={onBack} aria-label={t('common.back')}>‹</button>
        <div><span>{t('settings.kicker')}</span><h2>{t('settings.title')}</h2></div>
      </header>

      <section className="settings-avatar-card">
        <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
          {avatarUrl ? <img src={apiAssetUrl(avatarUrl)} alt="" /> : <i>{name.slice(0, 2).toUpperCase()}</i>}
          <span>{t('settings.change')}</span>
        </button>
        <div><strong>{t('settings.photo')}</strong><p>{t('settings.photoHint')}</p></div>
        <input ref={inputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" capture="user"
          onChange={(event) => void upload(event.target.files?.[0])} />
      </section>

      <section className="settings-form-card">
        <div className="settings-section-title"><span>{t('settings.identity')}</span><p>{t('settings.identityHint')}</p></div>
        <label>{t('settings.traderName')}<input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} /></label>
        <label>{t('settings.email')}<input value={user.email} disabled /></label>
        <label>{t('settings.phone')}<input value={phone} inputMode="tel" readOnly /></label>
      </section>

      <section className="settings-form-card">
        <div className="settings-section-title"><span>{t('settings.socials')}</span><p>{t('settings.socialsHint')}</p></div>
        <label>X / Twitter<input value={socials.x} placeholder="@pseudo"
          onChange={(event) => setSocials({ ...socials, x: event.target.value })} /></label>
        <label>Instagram<input value={socials.instagram} placeholder="@pseudo"
          onChange={(event) => setSocials({ ...socials, instagram: event.target.value })} /></label>
        <label>Discord<input value={socials.discord} placeholder="pseudo"
          onChange={(event) => setSocials({ ...socials, discord: event.target.value })} /></label>
        <label>{t('settings.website')}<input value={socials.website} inputMode="url" placeholder="https://..."
          onChange={(event) => setSocials({ ...socials, website: event.target.value })} /></label>
      </section>

      <section className="settings-form-card">
        <div className="settings-section-title"><span>{t('profile.language')}</span><p>{t('profile.languageHint')}</p></div>
        <LanguageSwitcher />
      </section>

      <section className="settings-security">
        <span>{t('settings.security')}</span>
        <strong>{t('settings.passwordless')}</strong>
        <p>{t('settings.passwordlessHint')}</p>
      </section>

      {error && <p className="settings-feedback is-error">{error}</p>}
      {message && <p className="settings-feedback is-success">{message}</p>}
      <button className="settings-save" type="button" disabled={busy || !name.trim()} onClick={() => void save()}>
        {busy ? t('settings.saving') : t('settings.save')}
      </button>

      <section className="settings-danger">
        <span>{t('settings.danger')}</span>
        <strong>{t('settings.deleteTitle')}</strong>
        <p>{confirmDelete ? t('settings.deleteConfirmLead') : t('settings.deleteHint')}</p>
        {confirmDelete ? (
          <div className="settings-danger-actions">
            <button type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>
              {t('settings.deleteCancel')}
            </button>
            <button className="is-destroy" type="button" disabled={busy} onClick={() => void removeAccount()}>
              {busy ? t('settings.deleteBusy') : t('settings.deleteConfirm')}
            </button>
          </div>
        ) : (
          <button className="is-destroy" type="button" disabled={busy} onClick={() => setConfirmDelete(true)}>
            {t('settings.deleteTitle')}
          </button>
        )}
      </section>
    </div>
  )
}
