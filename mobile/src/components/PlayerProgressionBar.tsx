import type { PlayerProgression } from '../lib/api'
import './PlayerProgressionBar.css'

export function PlayerProgressionBar({
  progression,
  variant = 'full',
}: {
  progression: PlayerProgression
  variant?: 'full' | 'compact'
}) {
  return <div className={`player-xp player-xp--${variant} rarity-${progression.title.rarity}`}>
    <div className="player-xp__head">
      <span><b>NIVEAU {progression.level}</b><em>{progression.title.label}</em></span>
      <strong>{variant === 'full' ? `${progression.totalXp.toLocaleString('fr-FR')} XP` : `${Math.round(progression.progressPercent)}%`}</strong>
    </div>
    <div className="player-xp__track"><i style={{ width: `${progression.progressPercent}%` }} /></div>
    {variant === 'full' && <div className="player-xp__foot">
      <span>{progression.xpIntoLevel.toLocaleString('fr-FR')} / {progression.xpForNextLevel.toLocaleString('fr-FR')} XP</span>
      <span>Prochain niveau</span>
    </div>}
  </div>
}
