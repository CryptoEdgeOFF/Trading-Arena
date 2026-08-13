import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { apiAssetUrl, getPromotions, type Promotion } from '../lib/api'
import './DealsScreen.css'

const categoryOrder: Promotion['category'][] = ['exchange', 'broker', 'prop', 'tool', 'community']
const categoryLabels: Record<Promotion['category'], string> = {
  exchange: 'Exchanges crypto',
  broker: 'Brokers',
  prop: 'Prop Firms',
  tool: 'Outils & ressources',
  community: 'Communauté',
}

function shortHighlight(highlight: string) {
  return highlight.match(/-?\d+%/)?.[0] || highlight.match(/\$?\d+\s?\$?/)?.[0] || (/plateforme gratuite|^free/i.test(highlight) ? 'Free' : highlight)
}

function DealCard({ deal, index, onOpen }: { deal: Promotion; index: number; onOpen: () => void }) {
  const live = Boolean(deal.referralUrl && deal.referralUrl !== '#')
  return (
    <motion.article className={`deal-card ${deal.featured ? 'is-featured' : ''}`}
      style={{ '--deal-accent': deal.accent } as React.CSSProperties}
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 5) * .04 }}>
      <button className="deal-card__summary" type="button" onClick={onOpen} aria-label={`Voir les détails de l’offre ${deal.name}`}>
        <span className="deal-card__logo">
          {deal.photoUrl ? <img src={apiAssetUrl(deal.photoUrl)} alt="" /> : <i>{deal.name.slice(0, 2).toUpperCase()}</i>}
        </span>
        <span className="deal-card__identity">
          <small>{categoryLabels[deal.category]}</small>
          <strong>{deal.name}</strong>
          {deal.highlight && <em>{deal.highlight}</em>}
        </span>
        {deal.highlight && <span className="deal-highlight">{shortHighlight(deal.highlight)}</span>}
        <span className="deal-card__details">Détails ›</span>
      </button>
      {live
        ? <a href={deal.referralUrl} target="_blank" rel="noopener noreferrer sponsored">VOIR L’OFFRE <span>↗</span></a>
        : <span className="deal-soon">BIENTÔT</span>}
    </motion.article>
  )
}

function DealDetails({ deal, onClose }: { deal: Promotion; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  async function copyCode() {
    if (!deal.promoCode) return
    try {
      await navigator.clipboard.writeText(deal.promoCode)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // Le code reste sélectionnable visuellement.
    }
  }
  const live = Boolean(deal.referralUrl && deal.referralUrl !== '#')
  return (
    <div className="deal-details-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <motion.section className="deal-details" role="dialog" aria-modal="true" aria-label={`Détails de l’offre ${deal.name}`}
      style={{ '--deal-accent': deal.accent } as React.CSSProperties}
      initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}>
      <button className="deal-details__close" type="button" onClick={onClose} aria-label="Fermer">×</button>
      <div className="deal-card__head">
        {deal.photoUrl ? <img src={apiAssetUrl(deal.photoUrl)} alt="" /> : <i>{deal.name.slice(0, 2).toUpperCase()}</i>}
        <div><small>{categoryLabels[deal.category]}</small><h3>{deal.name}</h3><p>{deal.tagline}</p></div>
      </div>
      {deal.highlight && <strong className="deal-details__highlight">{deal.highlight}</strong>}
      {deal.description && deal.description !== deal.tagline && <p className="deal-description">{deal.description}</p>}
      {deal.perks.length > 0 && <ul>{deal.perks.map((perk) => <li key={perk}><span>✓</span>{perk}</li>)}</ul>}
      <footer>
        {deal.promoCode && <button className="deal-code" type="button" onClick={() => void copyCode()}><small>CODE</small><strong>{deal.promoCode}</strong><span>{copied ? 'Copié ✓' : 'Copier'}</span></button>}
        {live ? <a href={deal.referralUrl} target="_blank" rel="noopener noreferrer sponsored">PROFITER DE L’OFFRE <span>↗</span></a> : <span className="deal-soon">BIENTÔT DISPONIBLE</span>}
      </footer>
      </motion.section>
    </div>
  )
}

export function DealsScreen() {
  const [deals, setDeals] = useState<Promotion[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDeal, setSelectedDeal] = useState<Promotion | null>(null)
  const grouped = useMemo(() => categoryOrder.map((category) => ({
    category,
    deals: deals.filter((deal) => deal.category === category && !deal.featured),
  })).filter((group) => group.deals.length), [deals])
  const featured = deals.filter((deal) => deal.featured)

  useEffect(() => {
    let active = true
    void getPromotions().then((next) => active && setDeals(next)).finally(() => active && setLoading(false))
    return () => { active = false }
  }, [])

  let index = 0
  return (
    <div className="deals-page">
      <section className="deals-hero">
        <span>OFFRES PARTENAIRES</span>
        <h1>Trade Live Bonus</h1>
        <p>Offres exclusives, bonus et codes promo négociés pour la communauté BTF.</p>
        <small>Ces liens sont des liens d’affiliation. Le trading comporte un risque de perte.</small>
      </section>
      {loading ? <div className="deals-state">Chargement des offres…</div> : !deals.length ? <div className="deals-state">Aucune offre disponible pour le moment.</div> : (
        <>
          {featured.length > 0 && <section className="deals-section"><header><span>MEILLEURES OFFRES</span><h2>À la une</h2></header><div>{featured.map((deal) => <DealCard key={deal.id} deal={deal} index={index++} onOpen={() => setSelectedDeal(deal)} />)}</div></section>}
          {grouped.map((group) => <section className="deals-section" key={group.category}><header><span>{categoryLabels[group.category].toUpperCase()}</span><h2>{categoryLabels[group.category]}</h2></header><div>{group.deals.map((deal) => <DealCard key={deal.id} deal={deal} index={index++} onOpen={() => setSelectedDeal(deal)} />)}</div></section>)}
        </>
      )}
      {selectedDeal && <DealDetails deal={selectedDeal} onClose={() => setSelectedDeal(null)} />}
    </div>
  )
}
