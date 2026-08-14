import { useEffect, useState } from 'react'
import {
  getPublicPlayerProfile,
  type PublicPlayerProfile,
  type UserBadge,
} from '../lib/api'
import { ProfileAvatar } from './ProfileAvatar'
import { translateTitle, useI18n } from '../i18n'
import './PlayerProfile.css'

const badgeNames: Record<UserBadge, string> = {
  btf2026: 'BTF 2026',
  champion: 'Champion',
  'paris-champion': 'Champion Paris',
  'summer-champion': 'Champion Summer',
  'autumn-champion': 'Champion Autumn',
}

function socialHref(kind: string, value: string) {
  if (/^https?:\/\//i.test(value)) return value
  const handle = value.replace(/^@/, '')
  if (kind === 'x') return `https://x.com/${handle}`
  if (kind === 'instagram') return `https://instagram.com/${handle}`
  if (kind === 'website') return `https://${value}`
  return ''
}

export function PlayerProfile({ userId, onBack }: { userId: string; onBack: () => void }) {
  const { t, locale, lang } = useI18n()
  const [profile, setProfile] = useState<PublicPlayerProfile | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setProfile(null)
    setError('')
    void getPublicPlayerProfile(userId).then((next) => active && setProfile(next))
      .catch((nextError) => active && setError(nextError instanceof Error ? nextError.message : t('player.missing')))
    return () => { active = false }
  }, [userId])

  return (
    <div className="player-profile-page">
      <header className="subpage-head"><button type="button" onClick={onBack}>‹</button><div><span>{t('player.kicker')}</span><h2>{t('player.title')}</h2></div></header>
      {error ? <div className="journal-state is-error">{error}</div> : !profile ? <div className="journal-state">{t('player.loading')}</div> : (
        <>
          <section className="public-profile-hero">
            <ProfileAvatar avatarUrl={profile.user.avatarUrl} name={profile.user.name} progression={profile.progression} size="lg" />
            <div className="public-profile-copy"><small>{t('player.traderLevel', { level: profile.progression?.level || 1 })}</small><h3>{profile.user.name}</h3>
              {profile.progression && <em className={`public-profile-title rarity-${profile.progression.title.rarity}`}>{translateTitle(lang, profile.progression.title.id, profile.progression.title.label)}</em>}
              <strong className={profile.totalPnlUsd >= 0 ? 'positive' : 'negative'}>{profile.totalPnlUsd >= 0 ? '+' : ''}{profile.totalPnlUsd.toFixed(2)} $</strong>
            </div>
          </section>
          {profile.user.socials && (
            <section className="public-socials">
              {Object.entries(profile.user.socials).filter(([, value]) => value).map(([kind, value]) => {
                const href = socialHref(kind, value!)
                return href ? <a key={kind} href={href} target="_blank" rel="noreferrer">{kind === 'x' ? 'X' : kind}</a> : <span key={kind} title={value}>{kind}</span>
              })}
            </section>
          )}
          <section className="public-profile-stats">
            <div><strong>{profile.stats.closedTrades}</strong><small>Trades</small></div>
            <div><strong>{(profile.stats.winRate * 100).toFixed(1)}%</strong><small>Win rate</small></div>
            <div><strong>{profile.stats.profitFactor?.toFixed(2) || '—'}</strong><small>Profit factor</small></div>
            <div><strong>{profile.stats.avgRR?.toFixed(2) || '—'}</strong><small>{t('journal.avgRR')}</small></div>
          </section>
          {profile.badges.length > 0 && <section className="profile-section"><span>{t('player.badges')}</span><div className="badge-list">{profile.badges.map((badge) => <div key={badge}>{badgeNames[badge]}</div>)}</div></section>}
          <section className="profile-section"><span>{t('player.arenas')}</span><div className="profile-arenas">{profile.arenas.map((arena) => <div key={arena.id}><div><strong>{arena.title}</strong><small>{arena.tradesCount} {t('profile.trades').toLowerCase()}</small></div><div><strong>#{arena.rank || '—'}</strong><small className={arena.pnlUsd >= 0 ? 'positive' : 'negative'}>{arena.pnlUsd >= 0 ? '+' : ''}{arena.pnlUsd.toFixed(2)} $</small></div></div>)}</div></section>
          {profile.payouts && profile.payouts.length > 0 && <section className="profile-section"><span>{t('player.payouts')}</span><div className="public-payouts">{profile.payouts.map((payout) => <div key={payout.id}><strong>{payout.amount.toLocaleString(locale)} {payout.currency}</strong><small>{new Date(payout.paidAt).toLocaleDateString(locale)}</small></div>)}</div></section>}
        </>
      )}
    </div>
  )
}
