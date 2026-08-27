import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { apiAssetUrl, getPromotions, type Promotion } from '../lib/api'
import { useI18n } from '../i18n'
import './DealsScreen.css'

const categoryOrder: Promotion['category'][] = ['exchange', 'broker', 'prop', 'tool', 'community']
const categoryKeys: Record<Promotion['category'], string> = {
  exchange: 'deals.exchange',
  broker: 'deals.broker',
  prop: 'deals.prop',
  tool: 'deals.tool',
  community: 'deals.community',
}
const whyKeys: Record<Promotion['category'], string> = {
  exchange: 'deals.whyExchange',
  broker: 'deals.whyBroker',
  prop: 'deals.whyProp',
  tool: 'deals.whyTool',
  community: 'deals.whyCommunity',
}

function shortHighlight(highlight: string) {
  return highlight.match(/-?\d+%/)?.[0] || highlight.match(/\$?\d+\s?\$?/)?.[0] || (/plateforme gratuite|^free/i.test(highlight) ? 'Free' : highlight)
}

function isLive(deal: Promotion) {
  return Boolean(deal.referralUrl && deal.referralUrl !== '#')
}

function dealCode(deal: Promotion) {
  return deal.promoCode?.trim() || ''
}

function dealPerk(deal: Promotion) {
  return deal.highlight?.trim() || deal.perks.find(Boolean) || deal.tagline || deal.name
}

function openSponsor(deal: Promotion) {
  if (!isLive(deal) || !deal.referralUrl) return
  window.open(deal.referralUrl, '_blank', 'noopener,noreferrer')
}

function usedByCount(id: string) {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0
  return 48 + (hash % 181)
}

function overlayRoot(node: ReactNode) {
  return createPortal(node, document.body)
}

function DealArrow() {
  return (
    <svg className="deal-arrow" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 12 12 4M6.2 4H12v5.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CopyIcon({ done }: { done?: boolean }) {
  if (done) {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="8.2" y="8.2" width="11.6" height="13" rx="2.2" stroke="currentColor" strokeWidth="2" />
      <path d="M15.8 8.2V6.4A2.2 2.2 0 0 0 13.6 4.2H6.4A2.2 2.2 0 0 0 4.2 6.4v11.2A2.2 2.2 0 0 0 6.4 19.8h1.8" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

function DealCodeRow({ code, copied, onCopy }: { code: string; copied: boolean; onCopy: () => void }) {
  const { t } = useI18n()
  return (
    <div className="deal-code">
      <div className="deal-code__value">
        <small>CODE</small>
        <strong>{code}</strong>
      </div>
      <button className="deal-code__copy" type="button" onClick={onCopy}>
        <CopyIcon done={copied} />
        <span>{copied ? t('deals.copied') : t('deals.copy')}</span>
      </button>
    </div>
  )
}

function DealCard({ deal, index, onOpen, onUnlock }: { deal: Promotion; index: number; onOpen: () => void; onUnlock: () => void }) {
  const { t } = useI18n()
  const live = isLive(deal)
  return (
    <motion.article className={`deal-card ${deal.featured ? 'is-featured' : ''}`}
      style={{ '--deal-accent': deal.accent } as React.CSSProperties}
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 5) * .04 }}>
      <button className="deal-card__summary" type="button" onClick={onOpen} aria-label={deal.name}>
        <span className="deal-card__logo">
          {deal.photoUrl ? <img src={apiAssetUrl(deal.photoUrl)} alt="" /> : <i>{deal.name.slice(0, 2).toUpperCase()}</i>}
        </span>
        <span className="deal-card__identity">
          <small>{t(categoryKeys[deal.category])}</small>
          <strong>{deal.name}</strong>
          {deal.highlight && <em>{deal.highlight}</em>}
        </span>
        {deal.highlight && <span className="deal-highlight">{shortHighlight(deal.highlight)}</span>}
        <span className="deal-card__details">{t('deals.details')}</span>
      </button>
      {live
        ? <button className="deal-cta" type="button" onClick={onUnlock}>{t('deals.viewOffer')}<DealArrow /></button>
        : <span className="deal-soon">{t('deals.soon')}</span>}
    </motion.article>
  )
}

async function copyDealCode(code: string) {
  try {
    await navigator.clipboard.writeText(code)
    return true
  } catch {
    return false
  }
}

function DealUnlockSheet({ deal, onClose }: { deal: Promotion; onClose: () => void }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const code = dealCode(deal)

  async function copyCode() {
    if (!code) return
    if (await copyDealCode(code)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
  }

  useEffect(() => {
    if (!code) return
    void copyDealCode(code).then((ok) => {
      if (ok) {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1600)
      }
    })
  }, [code])

  function continueToSponsor() {
    void copyCode()
    openSponsor(deal)
    onClose()
  }

  return overlayRoot(
    <div className="deal-details-layer deal-unlock-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <motion.section className="deal-unlock" role="dialog" aria-modal="true" aria-label={deal.name}
        style={{ '--deal-accent': deal.accent } as React.CSSProperties}
        initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}>
        <button className="deal-details__close" type="button" onClick={onClose} aria-label={t('common.close')}>×</button>
        <small>{t('deals.unlockKicker')}</small>
        <h3>{t('deals.unlockTitle', { name: deal.name })}</h3>
        <p>{t('deals.unlockLead', { code, perk: dealPerk(deal) })}</p>
        <DealCodeRow code={code} copied={copied} onCopy={() => void copyCode()} />
        <button className="deal-cta" type="button" onClick={continueToSponsor}>{t('deals.unlockContinue')}<DealArrow /></button>
      </motion.section>
    </div>
  )
}

function DealDetails({ deal, onClose, onUnlock }: { deal: Promotion; onClose: () => void; onUnlock: () => void }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  async function copyCode() {
    const code = dealCode(deal)
    if (!code) return
    if (await copyDealCode(code)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
  }
  const live = isLive(deal)
  return overlayRoot(
    <div className="deal-details-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <motion.section className="deal-details" role="dialog" aria-modal="true" aria-label={deal.name}
      style={{ '--deal-accent': deal.accent } as React.CSSProperties}
      initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}>
      <button className="deal-details__close" type="button" onClick={onClose} aria-label={t('common.close')}>×</button>
      <div className="deal-details__body">
        <div className="deal-card__head">
          {deal.photoUrl ? <img src={apiAssetUrl(deal.photoUrl)} alt="" /> : <i>{deal.name.slice(0, 2).toUpperCase()}</i>}
          <div><small>{t(categoryKeys[deal.category])}</small><h3>{deal.name}</h3><p>{deal.tagline}</p></div>
        </div>
        {deal.highlight && <strong className="deal-details__highlight">{deal.highlight}</strong>}
        {deal.description && deal.description !== deal.tagline && <p className="deal-description">{deal.description}</p>}
        {deal.perks.length > 0 && <ul>{deal.perks.map((perk) => <li key={perk}><span>✓</span>{perk}</li>)}</ul>}
      </div>
      <footer>
        {dealCode(deal) && <DealCodeRow code={dealCode(deal)} copied={copied} onCopy={() => void copyCode()} />}
        {live ? <button className="deal-cta" type="button" onClick={onUnlock}>{t('deals.useOffer')}<DealArrow /></button> : <span className="deal-soon">{t('deals.soonLong')}</span>}
      </footer>
      </motion.section>
    </div>
  )
}

export function DealsScreen({ onBack }: { onBack?: () => void }) {
  const { t, lang } = useI18n()
  const [deals, setDeals] = useState<Promotion[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDeal, setSelectedDeal] = useState<Promotion | null>(null)
  const [unlockDeal, setUnlockDeal] = useState<Promotion | null>(null)
  const [showCatalog, setShowCatalog] = useState(false)

  function requestUnlock(deal: Promotion) {
    if (dealCode(deal)) setUnlockDeal(deal)
    else openSponsor(deal)
  }
  const weekly = useMemo(
    () => deals.find((deal) => deal.featured && isLive(deal)) || deals.find(isLive) || deals[0] || null,
    [deals],
  )
  const picks = useMemo(
    () => deals.filter((deal) => deal.id !== weekly?.id && isLive(deal)).slice(0, 3),
    [deals, weekly],
  )
  const grouped = useMemo(() => categoryOrder.map((category) => ({
    category,
    deals: deals.filter((deal) => deal.category === category && !deal.featured),
  })).filter((group) => group.deals.length), [deals])
  const featured = deals.filter((deal) => deal.featured)

  useEffect(() => {
    let active = true
    void getPromotions(lang).then((next) => active && setDeals(next)).finally(() => active && setLoading(false))
    return () => { active = false }
  }, [lang])

  let index = 0
  return (
    <div className="deals-page">
      {loading ? <div className="deals-state">{t('deals.loading')}</div> : !deals.length ? <div className="deals-state">{t('deals.empty')}</div> : showCatalog ? (
        <>
          <header className="deals-catalog-head">
            <button type="button" onClick={() => setShowCatalog(false)}>‹ {t('deals.catalogBack')}</button>
            <div><span>{t('deals.catalogKicker')}</span><h2>{t('deals.catalogTitle')}</h2></div>
            <p>{t('deals.catalogLead')}</p>
          </header>
          {featured.length > 0 && <section className="deals-section"><header><span>{t('deals.featuredKicker')}</span><h2>{t('deals.featuredTitle')}</h2></header><div>{featured.map((deal) => <DealCard key={deal.id} deal={deal} index={index++} onOpen={() => setSelectedDeal(deal)} onUnlock={() => requestUnlock(deal)} />)}</div></section>}
          {grouped.map((group) => <section className="deals-section" key={group.category}><header><span>{t(categoryKeys[group.category]).toUpperCase()}</span><h2>{t(categoryKeys[group.category])}</h2></header><div>{group.deals.map((deal) => <DealCard key={deal.id} deal={deal} index={index++} onOpen={() => setSelectedDeal(deal)} onUnlock={() => requestUnlock(deal)} />)}</div></section>)}
        </>
      ) : (
        <>
          <header className="deals-perks-head">
            {onBack && <button className="deals-back" type="button" onClick={onBack}>‹ {t('common.back')}</button>}
            <span>{t('deals.kicker')}</span>
            <h1>{t('deals.title')}</h1>
            <p>{t('deals.lead')}</p>
          </header>

          {weekly && (
            <article className="perk-hero" style={{ '--deal-accent': weekly.accent } as React.CSSProperties}>
              <small>{t('deals.week')}</small>
              <div className="perk-hero__brand">
                {weekly.photoUrl ? <img src={apiAssetUrl(weekly.photoUrl)} alt="" /> : <i>{weekly.name.slice(0, 2).toUpperCase()}</i>}
                <div>
                  <em>{t(categoryKeys[weekly.category])}</em>
                  <strong>{weekly.name}</strong>
                </div>
                {weekly.highlight && <b>{shortHighlight(weekly.highlight)}</b>}
              </div>
              <p>{weekly.tagline || weekly.description}</p>
              <div className="perk-hero__why">
                <span>{t('deals.why')}</span>
                <p>{t(whyKeys[weekly.category])}</p>
              </div>
              <div className="perk-hero__proof">{t('deals.usedBy', { count: usedByCount(weekly.id) })}</div>
              <div className="perk-hero__actions">
                <button type="button" onClick={() => setSelectedDeal(weekly)}>{t('deals.details')}</button>
                {isLive(weekly)
                  ? <button className="deal-cta" type="button" onClick={() => requestUnlock(weekly)}>{t('deals.viewOffer')}<DealArrow /></button>
                  : <span className="deal-soon">{t('deals.soon')}</span>}
              </div>
            </article>
          )}

          {picks.length > 0 && (
            <section className="deals-section">
              <header><span>{t('deals.picks')}</span><h2>{t('deals.picksTitle')}</h2></header>
              <div>{picks.map((deal) => <DealCard key={deal.id} deal={deal} index={index++} onOpen={() => setSelectedDeal(deal)} onUnlock={() => requestUnlock(deal)} />)}</div>
            </section>
          )}

          <button className="deals-catalog-link" type="button" onClick={() => setShowCatalog(true)}>
            {t('deals.catalog')} <b>›</b>
          </button>
        </>
      )}
      <p className="deals-disclaimer">{t('deals.disclaimer')}</p>
      {selectedDeal && <DealDetails deal={selectedDeal} onClose={() => setSelectedDeal(null)} onUnlock={() => requestUnlock(selectedDeal)} />}
      {unlockDeal && <DealUnlockSheet deal={unlockDeal} onClose={() => setUnlockDeal(null)} />}
    </div>
  )
}
