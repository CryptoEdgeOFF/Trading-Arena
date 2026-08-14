import type { PlayerProgression } from '../lib/api'
import { translateTitle, useI18n } from '../i18n'
import './PlayerProgressionBar.css'

export function PlayerProgressionBar({
  progression,
  variant = 'full',
}: {
  progression: PlayerProgression
  variant?: 'full' | 'compact'
}) {
  const { t, locale, lang } = useI18n()
  return <div className={`player-xp player-xp--${variant} rarity-${progression.title.rarity}`}>
    <div className="player-xp__head">
      <span><b>{t('xp.level', { level: progression.level })}</b><em>{translateTitle(lang, progression.title.id, progression.title.label)}</em></span>
      <strong>{variant === 'full' ? `${progression.totalXp.toLocaleString(locale)} XP` : `${Math.round(progression.progressPercent)}%`}</strong>
    </div>
    <div className="player-xp__track"><i style={{ width: `${progression.progressPercent}%` }} /></div>
    {variant === 'full' && <div className="player-xp__foot">
      <span>{progression.xpIntoLevel.toLocaleString(locale)} / {progression.xpForNextLevel.toLocaleString(locale)} XP</span>
      <span>{t('xp.nextLevel')}</span>
    </div>}
  </div>
}
