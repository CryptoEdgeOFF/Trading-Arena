import { useState } from 'react'
import { motion } from 'framer-motion'
import { joinCompetition, registerTeamToCompetition, type ArenaTeam, type PublicCompetition } from '../lib/api'
import { getSponsor, isValidSponsorId } from '../lib/sponsors'
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
  const sponsor = getSponsor(competition.sponsor)
  const referralUrl = sponsor?.referralUrl || ''
  const isIntroGate = sponsor?.gateFlow === 'intro'
  const [step, setStep] = useState<'intro' | 'account' | 'confirm'>(isIntroGate ? 'intro' : 'confirm')
  const [accountMode, setAccountMode] = useState<'existing' | 'new'>('existing')
  const [code, setCode] = useState('')
  const [sponsorAccountId, setSponsorAccountId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    setBusy(true)
    setError('')
    try {
      const accountId = sponsorAccountId.trim() || undefined
      if (competition.entryMode === 'team') {
        if (!team?.id) throw new Error(t('join.teamRequired'))
        await registerTeamToCompetition(token, team.id, {
          competitionId: competition.id,
          sponsorAccountId: accountId,
        })
      } else {
        await joinCompetition(token, {
          competitionId: competition.id,
          code: code.trim() || undefined,
          sponsorAccountId: accountId,
        })
      }
      onJoined()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('join.error'))
    } finally {
      setBusy(false)
    }
  }

  function continueFromAccount() {
    if (sponsor?.requiresAccountId && !sponsorAccountId.trim()) {
      setError(t('join.sponsorMissing', { name: sponsor.name }))
      return
    }
    if (sponsor && sponsorAccountId.trim() && !isValidSponsorId(sponsorAccountId, sponsor)) {
      setError(t('join.sponsorInvalid'))
      return
    }
    setError('')
    setStep('confirm')
  }

  return (
    <div className="join-arena-layer" role="dialog" aria-modal="true">
      <button className="join-arena-backdrop" type="button" onClick={onClose} aria-label={t('common.close')} />
      <motion.section className="join-arena-sheet" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}>
        <header>
          <div>
            <span>{sponsor ? t('join.partnerTag') : t('join.title')}</span>
            {(!isIntroGate || step === 'confirm') && <h3>{competition.title}</h3>}
          </div>
          <button type="button" onClick={onClose}>×</button>
        </header>

        {isIntroGate && step === 'intro' && sponsor && (
          <div className="join-arena-intro">
            <h3>{t('join.introTitle', { name: sponsor.name })}</h3>
            <p>{t('join.introSubtitle', { name: sponsor.name })}</p>
            <p>{t('join.ninjatraderAbout')}</p>
            {sponsor.platformImageUrl && (
              <img src={sponsor.platformImageUrl} alt={sponsor.name} />
            )}
            <button
              className="join-arena-submit"
              type="button"
              style={{ background: sponsor.accent }}
              onClick={() => {
                if (referralUrl) window.open(referralUrl, '_blank', 'noopener,noreferrer')
                setAccountMode('new')
                setStep('account')
                setError('')
              }}
            >
              {t('join.signUpFree')}
            </button>
            <button className="join-arena-secondary" type="button" onClick={() => { setAccountMode('existing'); setStep('account'); setError('') }}>
              {t('join.alreadyHaveAccount')}
            </button>
          </div>
        )}

        {isIntroGate && step === 'account' && sponsor && (
          <div className="join-arena-intro">
            <h3>{accountMode === 'new' ? t('join.creatingAccount') : t('join.alreadyHaveAccount')}</h3>
            {accountMode === 'existing' ? (
              <>
                <label>{t('join.emailLabel', { name: sponsor.name })} <small>{t('join.emailHint', { name: sponsor.name })}</small>
                  <input
                    type="email"
                    value={sponsorAccountId}
                    placeholder={t('join.emailPlaceholder')}
                    onChange={(event) => { setSponsorAccountId(event.target.value); setError('') }}
                  />
                </label>
                <p className="join-arena-warning">{t('join.emailVerifyWarning')}</p>
              </>
            ) : (
              <>
                <p>{t('join.signUpViaAffiliate')}</p>
                {referralUrl && (
                  <a className="join-arena-submit" href={referralUrl} target="_blank" rel="noopener noreferrer" style={{ background: sponsor.accent }}>
                    {t('join.signUpFree')}
                  </a>
                )}
                <p>{t('join.afterSignUpNote')}</p>
              </>
            )}
            {error && <p>{error}</p>}
            <div className="join-arena-actions">
              <button className="join-arena-secondary" type="button" onClick={() => setStep('intro')}>{t('join.back')}</button>
              {accountMode === 'existing' ? (
                <button className="join-arena-submit" type="button" onClick={continueFromAccount}>{t('join.continue')}</button>
              ) : (
                <button className="join-arena-submit" type="button" onClick={() => { setAccountMode('existing'); setError('') }}>{t('join.accountCreated')}</button>
              )}
            </div>
          </div>
        )}

        {step === 'confirm' && (
          <>
            <div className="join-arena-details">
              <div><small>{competition.entryMode === 'team' ? t('join.teams') : t('join.participants')}</small><strong>{competition.participants}</strong></div>
              <div><small>{t('join.start')}</small><strong>{new Date(competition.startAt).toLocaleDateString(locale)}</strong></div>
              <div><small>{t('join.prize')}</small><strong>{competition.cashPrize?.total ? `${competition.cashPrize.total.toLocaleString(locale)} ${competition.cashPrize.currency}` : '—'}</strong></div>
            </div>
            {competition.dailyDrawdownPercent != null && competition.dailyDrawdownPercent > 0 && (
              <div className="join-arena-rule">
                <strong>{t('join.dailyDrawdownRule', { percent: competition.dailyDrawdownPercent })}</strong>
                <small>{t('join.dailyDrawdownRuleDesc', { percent: competition.dailyDrawdownPercent })}</small>
              </div>
            )}
            {isIntroGate && sponsor && sponsorAccountId && (
              <p className="join-arena-team is-ready">{sponsor.name} · {sponsorAccountId}</p>
            )}
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
            {competition.sponsor && !isIntroGate && (
              <label>{competition.sponsor} ID <small>{t('join.sponsorHint')}</small>
                <input value={sponsorAccountId} placeholder={t('join.sponsorPlaceholder')}
                  onChange={(event) => setSponsorAccountId(event.target.value)} />
              </label>
            )}
            {error && <p>{error}</p>}
            <div className="join-arena-actions">
              {isIntroGate && <button className="join-arena-secondary" type="button" onClick={() => setStep('account')}>{t('join.back')}</button>}
              <button
                className="join-arena-submit"
                type="button"
                disabled={busy || (competition.entryMode === 'team' && (!team?.isComplete || team.ownerUserId !== userId))}
                onClick={() => void submit()}
              >
                {busy ? t('join.joining') : competition.entryMode === 'team' ? t('join.confirmTeam') : t('join.confirm')}
              </button>
            </div>
          </>
        )}
      </motion.section>
    </div>
  )
}
