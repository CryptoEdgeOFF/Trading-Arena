import { useState } from 'react'
import { apiAssetUrl } from '../lib/api'
import './ProfileAvatar.css'

function initials(name: string) {
  return name.slice(0, 2).toUpperCase()
}

export function TraderPhoto({
  avatarUrl,
  name,
}: {
  avatarUrl?: string | null
  name: string
}) {
  const [broken, setBroken] = useState(false)
  const src = avatarUrl ? apiAssetUrl(avatarUrl) : ''
  if (!src || broken) return <i>{initials(name)}</i>
  return <img src={src} alt="" onError={() => setBroken(true)} />
}

export function ProfileAvatar({
  avatarUrl,
  name,
  size = 'md',
}: {
  avatarUrl?: string | null
  name: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const [broken, setBroken] = useState(false)
  const src = avatarUrl ? apiAssetUrl(avatarUrl) : ''
  return <div className={`profile-xp-avatar is-${size} frame-rookie`}>
    <div className="profile-xp-avatar__image">
      {src && !broken
        ? <img src={src} alt="" onError={() => setBroken(true)} />
        : <span>{initials(name)}</span>}
    </div>
    <i className="profile-xp-avatar__frame" />
  </div>
}
