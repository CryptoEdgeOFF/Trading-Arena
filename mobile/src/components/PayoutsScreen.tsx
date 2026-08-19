import { useCallback, useEffect, useState } from 'react'
import { getMyPayouts, requestPayout, type MyPayout, type PayoutStatus } from '../lib/api'
import { useI18n } from '../i18n'
import './PayoutsScreen.css'

function isValidErc20(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr.trim())
}

function formatAmount(amount: number, currency: string): string {
  const cur = String(currency || 'USD').toUpperCase()
  const sym = cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : '$'
  return `${sym}${Number(amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

function rankLabel(rank?: number | null): string {
  const value = Number(rank)
  return Number.isFinite(value) && value > 0 ? `#${value}` : '—'
}

export function PayoutsScreen({
  token,
  onBack,
  onChanged,
}: {
  token: string
  onBack: () => void
  onChanged?: () => void
}) {
  const { t } = useI18n()
  const [payouts, setPayouts] = useState<MyPayout[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [submittingId, setSubmittingId] = useState<string | null>(null)
  const [addresses, setAddresses] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setPayouts(await getMyPayouts(token))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('payoutPage.invalidSession'))
    } finally {
      setLoading(false)
    }
  }, [t, token])

  useEffect(() => { void load() }, [load])

  async function submit(payout: MyPayout) {
    const addr = (addresses[payout.id] || '').trim()
    if (!isValidErc20(addr)) {
      setError(t('payoutPage.invalidAddress'))
      return
    }
    setSubmittingId(payout.id)
    setError('')
    try {
      await requestPayout(token, payout.id, addr)
      await load()
      onChanged?.()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('common.retry'))
    } finally {
      setSubmittingId(null)
    }
  }

  function statusLabel(status?: PayoutStatus) {
    const value = status || 'available'
    if (value === 'pending') return t('payoutPage.statusPending')
    if (value === 'approved') return t('payoutPage.statusApproved')
    return t('payoutPage.statusAvailable')
  }

  return (
    <div className="payouts-page">
      <header className="subpage-head">
        <button type="button" onClick={onBack}>‹</button>
        <div><span>{t('payoutPage.eyebrow')}</span><h2>{t('payoutPage.title')}</h2></div>
      </header>
      <p className="payouts-page__intro">{t('payoutPage.intro')}</p>
      {error && <div className="journal-state is-error">{error}</div>}
      {loading ? (
        <div className="journal-state">{t('common.loading')}</div>
      ) : payouts.length === 0 ? (
        <div className="payouts-page__empty">{t('payoutPage.empty')}</div>
      ) : (
        <div className="payouts-page__list">
          {payouts.map((payout) => {
            const status = payout.status || 'available'
            return (
              <article key={payout.id} className={`payouts-card is-${status}`}>
                <div className="payouts-card__top">
                  <div>
                    <strong>{payout.arenaTitle || t('payoutPage.unknownArena')}</strong>
                    <small>{t('payoutPage.place', { rank: rankLabel(payout.rank) })} · {formatAmount(payout.amount, payout.currency)}</small>
                  </div>
                  <em>{statusLabel(status)}</em>
                </div>
                {status === 'available' && (
                  <div className="payouts-card__claim">
                    <label>
                      {t('payoutPage.erc20Label')}
                      <input
                        value={addresses[payout.id] || ''}
                        onChange={(event) => setAddresses((prev) => ({ ...prev, [payout.id]: event.target.value }))}
                        placeholder="0x…"
                        spellCheck={false}
                        autoCapitalize="off"
                        autoCorrect="off"
                      />
                    </label>
                    <p>{t('payoutPage.erc20Hint')}</p>
                    <button type="button" disabled={submittingId === payout.id} onClick={() => void submit(payout)}>
                      {submittingId === payout.id ? t('common.loading') : t('payoutPage.requestBtn')}
                    </button>
                  </div>
                )}
                {status === 'pending' && (
                  <p className="payouts-card__note">
                    {t('payoutPage.pendingMsg')}
                    {payout.erc20Address && <code>{payout.erc20Address}</code>}
                  </p>
                )}
                {status === 'approved' && <p className="payouts-card__note is-ok">{t('payoutPage.approvedMsg')}</p>}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
