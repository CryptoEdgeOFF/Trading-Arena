import { useEffect, useState } from 'react'
import { getPromotions, type Promotion } from '../lib/api'
import { useI18n } from '../i18n'
import './HomeBonusCard.css'

export function HomeBonusCard({ onOpen }: { onOpen: () => void }) {
  const { t, lang } = useI18n()
  const [partners, setPartners] = useState<Promotion[]>([])

  useEffect(() => {
    let active = true
    void getPromotions(lang)
      .then((rows) => {
        if (active) setPartners(rows.filter((item) => item.photoUrl || item.featured).slice(0, 5))
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [lang])

  return (
    <button type="button" className="home-bonus-card" onClick={onOpen}>
      <span className="home-bonus-card__shine" aria-hidden="true" />
      <div className="home-bonus-card__pills">
        <em>{t('bonus.homeLive')}</em>
        <span>{t('bonus.homeKicker')}</span>
      </div>
      <h2>{t('bonus.homeTitleEm')}<b>{t('bonus.title')}</b></h2>
      <p>{t('bonus.homeSub')}</p>
      <ul>
        <li>{t('bonus.homePerkDeposit')}</li>
        <li>{t('bonus.homePerkFees')}</li>
        <li>{t('bonus.homePerkCodes')}</li>
      </ul>
      {partners.length > 0 && (
        <div className="home-bonus-card__partners">
          {partners.map((partner) => (
            <i key={partner.id}>
              {partner.photoUrl ? <img src={partner.photoUrl} alt="" /> : partner.name.slice(0, 2)}
            </i>
          ))}
        </div>
      )}
      <strong>{t('bonus.homeCta')} <b>›</b></strong>
    </button>
  )
}
