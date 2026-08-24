import { useEffect, useMemo, useRef, useState } from 'react';
import Seo from './Seo';
import './HomeLandingV3.css';

const media = '/landing/btf2026';
const aftermovie = '/landing/btf2026-aftermovie.mp4';

const heroShots = {
  arena: `${media}/20260604_ElliotLeCorre_Veiga_154748.webp`,
  crowd: `${media}/20260604_ElliotLeCorre_Veiga_123857.webp`,
  winner: `${media}/20260605_ElliotLeCorre_Veiga_181516.webp`,
  finale: `${media}/20260605_ElliotLeCorre_Veiga_194001.webp`,
  stage: `${media}/20260604_ElliotLeCorre_Veiga_092023.webp`,
  interview: `${media}/20260604_ElliotLeCorre_Veiga_110837.webp`,
  trader: `${media}/20260604_ElliotLeCorre_Veiga_154719.webp`,
  broadcast: `${media}/20260605_ElliotLeCorre_Veiga_154940.webp`,
  host: `${media}/20260605_ElliotLeCorre_Veiga_152405.webp`,
};

const gallery = [
  heroShots.stage,
  heroShots.interview,
  heroShots.crowd,
  heroShots.trader,
  heroShots.arena,
  heroShots.broadcast,
  heroShots.winner,
  `${media}/20260605_ElliotLeCorre_Veiga_155357.webp`,
];

const leaders = [
  ['01', 'NOVA QUEEN', 'FR', '+24.8%', 'Legend'],
  ['02', 'KRAKEN MIKE', 'BE', '+21.4%', 'Elite'],
  ['03', 'DARK PIPS', 'CH', '+19.1%', 'Elite'],
  ['04', 'ALPHA WOLF', 'FR', '+17.8%', 'Diamond'],
  ['05', 'MME CANDLE', 'BE', '+16.2%', 'Diamond'],
];

const formatCards = [
  ['01', 'Qualification en ligne', 'Une arène chaque semaine, règles identiques pour tous les traders.'],
  ['02', 'Classement saison', 'Ton PnL construit ta place. Seul le numéro 1 part à Paris.'],
  ['03', 'Finale live', 'Le meilleur trader monte sur scène au BTF 2027 devant le public.'],
];

function ArrowIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m0 0-6-6m6 6-6 6" /></svg>;
}

function nextMonday() {
  const now = new Date();
  const target = new Date(now);
  const days = (8 - now.getUTCDay()) % 7 || 7;
  target.setUTCDate(now.getUTCDate() + days);
  target.setUTCHours(8, 0, 0, 0);
  return target.getTime();
}

function useCountdown() {
  const target = useMemo(nextMonday, []);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const total = Math.max(0, target - now);
  return [
    ['Jours', Math.floor(total / 86_400_000)],
    ['Heures', Math.floor(total / 3_600_000) % 24],
    ['Min', Math.floor(total / 60_000) % 60],
    ['Sec', Math.floor(total / 1000) % 60],
  ] as const;
}

function useLandingMotion() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const items = element.querySelectorAll<HTMLElement>('[data-reveal]');
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.14, rootMargin: '0px 0px -8% 0px' });
    items.forEach((item) => observer.observe(item));
    const move = (event: PointerEvent) => {
      if (reduced) return;
      element.style.setProperty('--pointer-x', `${event.clientX}px`);
      element.style.setProperty('--pointer-y', `${event.clientY}px`);
      const x = (event.clientX / window.innerWidth - 0.5).toFixed(3);
      const y = (event.clientY / window.innerHeight - 0.5).toFixed(3);
      element.style.setProperty('--tilt-x', x);
      element.style.setProperty('--tilt-y', y);
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('pointermove', move);
    };
  }, []);
  return root;
}

export default function HomeLandingV3() {
  const root = useLandingMotion();
  const countdown = useCountdown();
  const [menu, setMenu] = useState(false);

  return (
    <div className="btf-v3" ref={root}>
      <Seo
        title="BTF 2027 — La ligue mondiale de trading"
        description="Qualifie-toi sur BTF Arena, deviens n°1 de la saison et monte sur scène à Paris pour le BTF 2027."
        path="/v3"
        image={heroShots.finale}
      />
      <div className="v3-noise" aria-hidden="true" />
      <div className="v3-pointer" aria-hidden="true" />

      <header className="v3-nav">
        <a href="/v3" className="v3-brand" aria-label="BTF 2027">
          <img src="/landing/btf-logo-header.png" alt="BTF Arena" />
          <span>Trading league</span>
        </a>
        <nav className={menu ? 'is-open' : ''}>
          {['Événement', 'Format', 'Classement', 'Archive', 'Partenaires'].map((label) => (
            <a key={label} href={`#${label.toLowerCase().replace('é', 'e')}`} onClick={() => setMenu(false)}>{label}</a>
          ))}
        </nav>
        <div className="v3-nav__actions">
          <a className="v3-login" href="/compete">Connexion</a>
          <a className="v3-button is-small" href="/compete">Entrer dans l’arène</a>
          <button type="button" className="v3-menu" onClick={() => setMenu((value) => !value)} aria-label="Menu"><i /><i /></button>
        </div>
      </header>

      <main>
        <section className="v3-hero" id="evenement">
          <video className="v3-hero__video" src={aftermovie} poster={heroShots.arena} autoPlay muted loop playsInline preload="metadata" disablePictureInPicture />
          <div className="v3-hero__shade" aria-hidden="true" />
          <div className="v3-hero__grid" aria-hidden="true"><i /><i /><i /><i /></div>

          <div className="v3-hero__content" data-reveal>
            <p className="v3-kicker"><i /> Saison 2027 · Qualifications ouvertes</p>
            <h1>
              <span>BTF</span>
              <strong>2027</strong>
            </h1>
            <p className="v3-hero__lead">La ligue où les meilleurs traders quittent leur écran pour monter sur scène. Une saison. Un classement. Une finale live à Paris.</p>
            <div className="v3-countdown" aria-label="Prochaine arène">
              {countdown.map(([label, value]) => (
                <span key={label}><b>{String(value).padStart(2, '0')}</b><em>{label}</em></span>
              ))}
            </div>
            <div className="v3-actions">
              <a className="v3-button" href="/compete">Rejoindre BTF Arena <ArrowIcon /></a>
              <a className="v3-button is-ghost" href="#archive">Voir l’aftermovie</a>
            </div>
          </div>

          <aside className="v3-hero-card" data-reveal>
            <span>Next major</span>
            <img src={heroShots.winner} alt="Champion BTF 2026" />
            <div>
              <small>Paris · BTF 2027</small>
              <strong>1 place par saison</strong>
            </div>
          </aside>
        </section>

        <section className="v3-ticker" aria-label="Points clés">
          <div>
            <span>100% simulé</span>
            <span>Classement live</span>
            <span>Arena points</span>
            <span>Finale à Paris</span>
            <span>1 marché</span>
            <span>1 arène</span>
            <span>1 champion</span>
          </div>
        </section>

        <section className="v3-intro" id="format">
          <div className="v3-section-title" data-reveal>
            <p>Format</p>
            <h2>Une ligue.<br />Trois niveaux de pression.</h2>
          </div>
          <div className="v3-format">
            {formatCards.map(([number, title, text]) => (
              <article key={number} data-reveal>
                <b>{number}</b>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="v3-arena">
          <div className="v3-arena__visual" data-reveal>
            <img src="/assets/pictures/arena3d.png" alt="Arène BTF" />
            <span className="v3-orbit v3-orbit--one" />
            <span className="v3-orbit v3-orbit--two" />
          </div>
          <div className="v3-arena__content" data-reveal>
            <p className="v3-kicker"><i /> BTF Arena</p>
            <h2>Joue chaque semaine.<br />Construis ta légende.</h2>
            <p>L’arène hebdomadaire ouvre tous les lundis à 08:00 UTC. Tout le monde part du même capital, avec les mêmes règles. La performance parle.</p>
            <div className="v3-stats">
              <span><b>100K</b><small>Capital simulé</small></span>
              <span><b>7J</b><small>Par arène</small></span>
              <span><b>#1</b><small>Qualifié Paris</small></span>
            </div>
            <a className="v3-button" href="/compete/live">Voir le live <ArrowIcon /></a>
          </div>
        </section>

        <section className="v3-ranking" id="classement">
          <div className="v3-section-title" data-reveal>
            <p>Classement</p>
            <h2>La route est simple.<br />La victoire ne l’est pas.</h2>
          </div>
          <div className="v3-ranking__board" data-reveal>
            <div className="v3-ranking__head"><span>#</span><span>Trader</span><span>Pays</span><span>PnL</span><span>Division</span></div>
            {leaders.map((row) => (
              <div className="v3-ranking__row" key={row[1]}>
                {row.map((value) => <span key={value}>{value}</span>)}
              </div>
            ))}
            <div className="v3-ranking__you">
              <span>Toi</span>
              <strong>Pas encore classé</strong>
              <a href="/compete/rank">Voir le classement complet</a>
            </div>
          </div>
        </section>

        <section className="v3-gallery" id="archive">
          <div className="v3-section-title" data-reveal>
            <p>Archive BTF 2026</p>
            <h2>La première édition.<br />Le début d’une ligue.</h2>
          </div>
          <div className="v3-gallery__grid">
            {gallery.map((src, index) => (
              <figure key={src} className={`v3-gallery__item v3-gallery__item--${index + 1}`} data-reveal>
                <img src={src} alt="BTF 2026" loading={index > 2 ? 'lazy' : 'eager'} />
              </figure>
            ))}
          </div>
        </section>

        <section className="v3-moment" data-reveal>
          <video src={aftermovie} poster={heroShots.finale} controls playsInline preload="metadata" />
          <div>
            <p className="v3-kicker"><i /> Aftermovie officiel</p>
            <h2>Revivre BTF 2026</h2>
            <p>La salle, la pression, les marchés et le moment où un trader devient champion.</p>
          </div>
        </section>

        <section className="v3-sponsors" id="partenaires" data-reveal>
          <p>Partenaires officiels</p>
          <div>
            <img src="/assets/pictures/kraken-logo-white.webp" alt="Kraken" />
            <img src="/assets/pictures/ninjatrader-logo.webp" alt="NinjaTrader" />
          </div>
        </section>

        <section className="v3-final">
          <img src={heroShots.crowd} alt="" />
          <div data-reveal>
            <p>Paris t’attend</p>
            <h2>Prêt à devenir<br />le prochain champion ?</h2>
            <a className="v3-button" href="/compete">Entrer dans la ligue <ArrowIcon /></a>
          </div>
        </section>
      </main>

      <footer className="v3-footer">
        <a href="/v3"><img src="/landing/btf-logo-header.png" alt="BTF" /></a>
        <span>© 2026–2027 BTF · Trading simulé</span>
        <nav>
          <a href="/cgu">CGU</a>
          <a href="/risques">Risques</a>
          <a href="/compete">BTF Arena ↗</a>
        </nav>
      </footer>
    </div>
  );
}
