import { apiAssetUrl } from '../lib/api'
import './ProfileAvatar.css'

export function ProfileAvatar({
  avatarUrl,
  name,
  size = 'md',
}: {
  avatarUrl?: string | null
  name: string
  size?: 'sm' | 'md' | 'lg'
}) {
  return <div className={`profile-xp-avatar is-${size} frame-rookie`}>
    <div className="profile-xp-avatar__image">
      {avatarUrl ? <img src={apiAssetUrl(avatarUrl)} alt="" /> : <span>{name.slice(0, 2).toUpperCase()}</span>}
    </div>
    <i className="profile-xp-avatar__frame" />
  </div>
}
