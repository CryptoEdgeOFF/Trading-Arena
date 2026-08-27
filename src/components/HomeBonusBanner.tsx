import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import './HomeBonusBanner.css';

type PromoPreview = {
  id: string;
  name: string;
  photoUrl?: string | null;
  featured?: boolean;
};

export default function HomeBonusBanner({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const [partners, setPartners] = useState<PromoPreview[]>([]);
  const lang = i18n.language?.startsWith('en') ? 'en' : 'fr';

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/promotions?lang=${lang}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const list = Array.isArray(data.promotions) ? data.promotions as PromoPreview[] : [];
        setPartners(list.filter((item) => item.photoUrl || item.featured).slice(0, 5));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [lang]);

  return (
    <section className={`home-bonus${compact ? ' is-compact' : ''}`}>
      <Link to="/compete/bonus" className="home-bonus__card">
        <span className="home-bonus__shine" aria-hidden="true" />
        <span className="home-bonus__orb" aria-hidden="true" />
        <div className="home-bonus__copy">
          <div className="home-bonus__pills">
            <em>{t('bonus.homeLive')}</em>
            <span>{t('bonus.homeKicker')}</span>
          </div>
          <h2>
            {t('bonus.homeTitleEm')}
            <b>{t('bonus.title')}</b>
          </h2>
          <p>{t('bonus.homeSub')}</p>
          <ul>
            <li>{t('bonus.homePerkDeposit')}</li>
            <li>{t('bonus.homePerkFees')}</li>
            <li>{t('bonus.homePerkCodes')}</li>
          </ul>
          {partners.length > 0 && (
            <div className="home-bonus__partners">
              {partners.map((partner) => (
                <i key={partner.id} title={partner.name}>
                  {partner.photoUrl
                    ? <img src={partner.photoUrl} alt="" />
                    : partner.name.slice(0, 2)}
                </i>
              ))}
            </div>
          )}
        </div>
        <div className="home-bonus__aside">
          <strong>%</strong>
          <span className="home-bonus__cta">
            {t('bonus.homeCta')}
            <b>›</b>
          </span>
        </div>
      </Link>
    </section>
  );
}
