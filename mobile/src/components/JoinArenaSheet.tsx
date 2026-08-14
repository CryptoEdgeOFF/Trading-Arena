import { useState } from 'react'
import { motion } from 'framer-motion'
import { joinCompetition, type PublicCompetition } from '../lib/api'
import { useI18n } from '../i18n'
import './JoinArenaSheet.css'

export function JoinArenaSheet({
  token,
  competition,
  onJoined,
  onClose,
}: {
  token: string
  competition: PublicCompetition
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
      await joinCompetition(token, {
        competitionId: competition.id,
        code: code.trim() || undefined,
        sponsorAccountId: sponsorAccountId.trim() || undefined,
      })
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
          <div><small>{t('join.participants')}</small><strong>{competition.participants}</strong></div>
          <div><small>{t('join.start')}</small><strong>{new Date(competition.startAt).toLocaleDateString(locale)}</strong></div>
          <div><small>{t('join.prize')}</small><strong>{competition.cashPrize?.total ? `${competition.cashPrize.total.toLocaleString(locale)} ${competition.cashPrize.currency}` : '—'}</strong></div>
        </div>
        <label>{t('join.code')} <small>{t('join.codeHint')}</small>
          <input value={code} autoCapitalize="characters" placeholder="CODE"
            onChange={(event) => setCode(event.target.value.toUpperCase())} />
        </label>
        {competition.sponsor && (
          <label>{competition.sponsor} ID <small>{t('join.sponsorHint')}</small>
            <input value={sponsorAccountId} placeholder={t('join.sponsorPlaceholder')}
              onChange={(event) => setSponsorAccountId(event.target.value)} />
          </label>
        )}
        {error && <p>{error}</p>}
        <button className="join-arena-submit" type="button" disabled={busy} onClick={() => void submit()}>
          {busy ? t('join.joining') : t('join.confirm')}
        </button>
      </motion.section>
    </div>
  )
}
