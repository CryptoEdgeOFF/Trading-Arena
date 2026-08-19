import { useState } from 'react'
import { motion } from 'framer-motion'
import { joinCompetition, registerTeamToCompetition, type ArenaTeam, type PublicCompetition } from '../lib/api'
import { useI18n } from '../i18n'
import './JoinArenaSheet.css'

export function JoinArenaSheet({
  token,
  userId,
  competition,
  team,
  onJoined,
  onClose,
}: {
  token: string
  userId?: string
  competition: PublicCompetition
  team?: ArenaTeam | null
  onJoined: () => void
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  const [code, setCode] = useState('')
  const [sponsorAccountId, setSponsorAccountId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    setBusy(true)
    setError('')
    try {
      if (competition.entryMode === 'team') {
        if (!team?.id) throw new Error(t('join.teamRequired'))
        await registerTeamToCompetition(token, team.id, {
          competitionId: competition.id,
          sponsorAccountId: sponsorAccountId.trim() || undefined,
        })
      } else {
        await joinCompetition(token, {
          competitionId: competition.id,
          code: code.trim() || undefined,
          sponsorAccountId: sponsorAccountId.trim() || undefined,
        })
      }
      onJoined()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('join.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="join-arena-layer" role="dialog" aria-modal="true">
      <button className="join-arena-backdrop" type="button" onClick={onClose} aria-label={t('common.close')} />
      <motion.section className="join-arena-sheet" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}>
        <header><div><span>{t('join.title')}</span><h3>{competition.title}</h3></div><button type="button" onClick={onClose}>×</button></header>
        <div className="join-arena-details">
          <div><small>{competition.entryMode === 'team' ? t('join.teams') : t('join.participants')}</small><strong>{competition.participants}</strong></div>
          <div><small>{t('join.start')}</small><strong>{new Date(competition.startAt).toLocaleDateString(locale)}</strong></div>
          <div><small>{t('join.prize')}</small><strong>{competition.cashPrize?.total ? `${competition.cashPrize.total.toLocaleString(locale)} ${competition.cashPrize.currency}` : '—'}</strong></div>
        </div>
        {competition.entryMode === 'team' ? (
          <p className={`join-arena-team ${team?.isComplete && team.ownerUserId === userId ? 'is-ready' : ''}`}>
            {!team ? t('join.teamRequired')
              : !team.isComplete ? t('join.teamMissing')
                : team.ownerUserId !== userId ? t('join.teamOwnerOnly')
                  : t('join.teamReady', { name: team.name })}
          </p>
        ) : (
          <label>{t('join.code')} <small>{t('join.codeHint')}</small>
            <input value={code} autoCapitalize="characters" placeholder="CODE"
              onChange={(event) => setCode(event.target.value.toUpperCase())} />
          </label>
        )}
        {competition.sponsor && (
          <label>{competition.sponsor} ID <small>{t('join.sponsorHint')}</small>
            <input value={sponsorAccountId} placeholder={t('join.sponsorPlaceholder')}
              onChange={(event) => setSponsorAccountId(event.target.value)} />
          </label>
        )}
        {error && <p>{error}</p>}
        <button className="join-arena-submit" type="button" disabled={busy || (competition.entryMode === 'team' && (!team?.isComplete || team.ownerUserId !== userId))} onClick={() => void submit()}>
          {busy ? t('join.joining') : competition.entryMode === 'team' ? t('join.confirmTeam') : t('join.confirm')}
        </button>
      </motion.section>
    </div>
  )
}
