import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from './LanguageSwitcher';
import { COMPETE_SESSION_KEY, writeCachedCompeteUser } from '../lib/competeSession';

function Icon({ path }: { path: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

const ICONS = {
  journal: 'M5 3h14v18H5V3Zm4 5h6m-6 4h6m-6 4h4',
  payouts: 'M4 7h16v12H4V7Zm2 4h12M8 7V5h8v2',
  settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.4-3.5a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a8 8 0 0 0-1.7-1L15 3.5h-4L10.6 6a8 8 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a8 8 0 0 0 1.7 1l.4 2.5h4l.4-2.5a8 8 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6a7 7 0 0 0 .1-1Z',
  bonus: 'M20 12v8H4v-8M2 7h20v5H2V7Zm10 13V7m0 0H7.5A2.5 2.5 0 1 1 12 4.8M12 7h4.5A2.5 2.5 0 1 0 12 4.8',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
};

export default function MobileAccountActions() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  function logout() {
    window.localStorage.removeItem(COMPETE_SESSION_KEY);
    writeCachedCompeteUser(null);
    navigate('/compete');
  }

  const links = [
    { to: '/compete/journal', icon: ICONS.journal, title: t('user.tradeJournal'), hint: t('account.journalHint') },
    { to: '/compete/payouts', icon: ICONS.payouts, title: t('header.payouts'), hint: t('account.payoutsHint') },
    { to: '/compete/settings', icon: ICONS.settings, title: t('header.settings'), hint: t('account.settingsHint') },
    { to: '/compete/bonus', icon: ICONS.bonus, title: t('bonus.navLabel'), hint: t('account.bonusHint') },
  ];

  return (
    <section className="mobile-account" aria-label={t('header.account')}>
      <div className="mobile-account__list">
        {links.map((item) => (
          <Link key={item.to} to={item.to} className="mobile-account__row">
            <span><Icon path={item.icon} /></span>
            <div>
              <strong>{item.title}</strong>
              <small>{item.hint}</small>
            </div>
            <i>›</i>
          </Link>
        ))}
      </div>
      <div className="mobile-account__lang">
        <div>
          <strong>{t('lang.label')}</strong>
          <small>{t('account.languageHint')}</small>
        </div>
        <LanguageSwitcher />
      </div>
      <button type="button" className="mobile-account__logout" onClick={logout}>
        <span><Icon path={ICONS.logout} /></span>
        {t('header.logout')}
      </button>
    </section>
  );
}
