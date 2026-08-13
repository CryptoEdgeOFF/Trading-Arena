import { useState } from 'react'
import { motion } from 'framer-motion'
import { joinCompetition, type PublicCompetition } from '../lib/api'
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
      setError(nextError instanceof Error ? nextError.message : 'Inscription impossible')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="join-arena-layer" role="dialog" aria-modal="true">
      <button className="join-arena-backdrop" type="button" onClick={onClose} aria-label="Fermer" />
      <motion.section className="join-arena-sheet" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}>
        <header><div><span>REJOINDRE L’ARÈNE</span><h3>{competition.title}</h3></div><button type="button" onClick={onClose}>×</button></header>
        <div className="join-arena-details">
          <div><small>Participants</small><strong>{competition.participants}</strong></div>
          <div><small>Début</small><strong>{new Date(competition.startAt).toLocaleDateString('fr-FR')}</strong></div>
          <div><small>Dotation</small><strong>{competition.cashPrize?.total ? `${competition.cashPrize.total.toLocaleString('fr-FR')} ${competition.cashPrize.currency}` : '—'}</strong></div>
        </div>
        <label>Code de l’arène <small>Laisse vide si l’arène est ouverte.</small>
          <input value={code} autoCapitalize="characters" placeholder="CODE"
            onChange={(event) => setCode(event.target.value.toUpperCase())} />
        </label>
        {competition.sponsor && (
          <label>Identifiant {competition.sponsor} <small>Requis uniquement par certains partenaires.</small>
            <input value={sponsorAccountId} placeholder="Identifiant du compte"
              onChange={(event) => setSponsorAccountId(event.target.value)} />
          </label>
        )}
        {error && <p>{error}</p>}
        <button className="join-arena-submit" type="button" disabled={busy} onClick={() => void submit()}>
          {busy ? 'INSCRIPTION…' : 'CONFIRMER MON INSCRIPTION'}
        </button>
      </motion.section>
    </div>
  )
}
