import { apiAssetUrl, type PlayerProgression } from '../lib/api'
import './ProfileAvatar.css'

export function ProfileAvatar({
  avatarUrl,
  name,
  progression,
  size = 'md',
}: {
  avatarUrl?: string | null
  name: string
  progression?: PlayerProgression | null
  size?: 'sm' | 'md' | 'lg'
}) {
  const frame = progression?.frame.id || 'rookie'
  return <div className={`profile-xp-avatar is-${size} frame-${frame}`} title={progression?.frame.label}>
    <div className="profile-xp-avatar__image">
      {avatarUrl ? <img src={apiAssetUrl(avatarUrl)} alt="" /> : <span>{name.slice(0, 2).toUpperCase()}</span>}
    </div>
    <i className="profile-xp-avatar__frame" />
    {progression && <b>{progression.level}</b>}
  </div>
}
