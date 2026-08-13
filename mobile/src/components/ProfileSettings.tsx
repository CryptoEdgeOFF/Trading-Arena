import { useRef, useState } from 'react'
import {
  apiAssetUrl,
  updateUserProfile,
  uploadUserAvatar,
  type SessionUser,
} from '../lib/api'
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
  onBack,
}: {
  token: string
  user: SessionUser
  onUpdated: (user: SessionUser) => void
  onBack: () => void
}) {
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
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function save() {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const nextUser = await updateUserProfile(token, { name, phone, socials })
      onUpdated(nextUser)
      setMessage('Profil mis à jour.')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Modification impossible')
    } finally {
      setBusy(false)
    }
  }

  async function upload(file?: File) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Choisis une image valide.')
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
      setMessage('Photo de profil mise à jour.')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Envoi impossible')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="settings-page">
      <header className="subpage-head">
        <button type="button" onClick={onBack} aria-label="Retour">‹</button>
        <div><span>MON COMPTE</span><h2>Réglages</h2></div>
      </header>

      <section className="settings-avatar-card">
        <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
          {avatarUrl ? <img src={apiAssetUrl(avatarUrl)} alt="" /> : <i>{name.slice(0, 2).toUpperCase()}</i>}
          <span>Changer</span>
        </button>
        <div><strong>Photo de profil</strong><p>JPG, PNG ou photo prise avec ton téléphone.</p></div>
        <input ref={inputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" capture="user"
          onChange={(event) => void upload(event.target.files?.[0])} />
      </section>

      <section className="settings-form-card">
        <div className="settings-section-title"><span>IDENTITÉ</span><p>Ces informations sont visibles dans les classements.</p></div>
        <label>Nom de trader<input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} /></label>
        <label>E-mail<input value={user.email} disabled /></label>
        <label>Téléphone<input value={phone} inputMode="tel" readOnly /></label>
      </section>

      <section className="settings-form-card">
        <div className="settings-section-title"><span>RÉSEAUX SOCIAUX</span><p>Ajoute un pseudo ou une URL complète.</p></div>
        <label>X / Twitter<input value={socials.x} placeholder="@pseudo"
          onChange={(event) => setSocials({ ...socials, x: event.target.value })} /></label>
        <label>Instagram<input value={socials.instagram} placeholder="@pseudo"
          onChange={(event) => setSocials({ ...socials, instagram: event.target.value })} /></label>
        <label>Discord<input value={socials.discord} placeholder="pseudo"
          onChange={(event) => setSocials({ ...socials, discord: event.target.value })} /></label>
        <label>Site web<input value={socials.website} inputMode="url" placeholder="https://..."
          onChange={(event) => setSocials({ ...socials, website: event.target.value })} /></label>
      </section>

      <section className="settings-security">
        <span>SÉCURITÉ</span>
        <strong>Connexion sans mot de passe</strong>
        <p>Comme sur la webapp, ton compte BTF utilise un code unique envoyé par e-mail, puis la vérification téléphone à l’inscription. Il n’existe donc aucun mot de passe stocké à modifier.</p>
      </section>

      {error && <p className="settings-feedback is-error">{error}</p>}
      {message && <p className="settings-feedback is-success">{message}</p>}
      <button className="settings-save" type="button" disabled={busy || !name.trim()} onClick={() => void save()}>
        {busy ? 'ENREGISTREMENT…' : 'ENREGISTRER LES MODIFICATIONS'}
      </button>
    </div>
  )
}
