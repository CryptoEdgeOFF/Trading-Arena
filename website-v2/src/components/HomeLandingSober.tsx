import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import Seo from './Seo';
import './HomeLandingSober.css';

const media = '/landing/btf2026';
const film = '/landing/btf2026-aftermovie.mp4';
const shots = {
  stage: `${media}/20260604_ElliotLeCorre_Veiga_092023.webp`,
  interview: `${media}/20260604_ElliotLeCorre_Veiga_110837.webp`,
  crowd: `${media}/20260604_ElliotLeCorre_Veiga_123857.webp`,
  trader: `${media}/20260604_ElliotLeCorre_Veiga_154719.webp`,
  arena: `${media}/20260604_ElliotLeCorre_Veiga_154748.webp`,
  desk: `${media}/20260604_ElliotLeCorre_Veiga_154907.webp`,
  host: `${media}/20260605_ElliotLeCorre_Veiga_152405.webp`,
  broadcast: `${media}/20260605_ElliotLeCorre_Veiga_154940.webp`,
  winner: `${media}/20260605_ElliotLeCorre_Veiga_181516.webp`,
  finale: `${media}/20260605_ElliotLeCorre_Veiga_194001.webp`,
};

const ranking = [
  ['01', 'NOVA QUEEN', 'FR', '18,540', '7'],
  ['02', 'KRAKEN MIKE', 'BE', '17,280', '6'],
  ['03', 'DARK PIPS', 'CH', '15,430', '5'],
  ['04', 'ALPHA WOLF', 'FR', '14,620', '5'],
  ['05', 'MME CANDLE', 'BE', '13,890', '4'],
];

const traders = [
  { name: 'NOVA QUEEN', role: 'Momentum trader', win: '68%', image: shots.interview },
  { name: 'KRAKEN MIKE', role: 'Technical specialist', win: '64%', image: shots.trader },
  { name: 'DARK PIPS', role: 'Macro analyst', win: '61%', image: shots.host },
  { name: 'ALPHA WOLF', role: 'Discipline master', win: '59%', image: shots.broadcast },
  { name: 'MME CANDLE', role: 'Pattern reader', win: '57%', image: shots.desk },
];

function Arrow() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m0 0-6-6m6 6-6 6" /></svg>;
}

function StageIcon({ type }: { type: 'flag' | 'rank' | 'shield' | 'stage' }) {
  const paths = {
    flag: 'M5 21V4m0 1h11l-2 4 2 4H5',
    rank: 'M4 20V11h4v9m4 0V4h4v16m4 0v-6h-4',
    shield: 'M12 3 20 6v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6l8-3Zm-3 9 2 2 4-5',
    stage: 'M3 19h18M5 19v-6l7-4 7 4v6M8 19v-4h8v4M4 8l8-5 8 5',
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[type]} /></svg>;
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
  return {
    days: Math.floor(total / 86_400_000),
    hours: Math.floor(total / 3_600_000) % 24,
    mins: Math.floor(total / 60_000) % 60,
    secs: Math.floor(total / 1000) % 60,
  };
}

function useMotion() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const items = root.querySelectorAll<HTMLElement>('[data-rise]');
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      });
    }, { threshold: .1, rootMargin: '0px 0px -6% 0px' });
    items.forEach((item) => observer.observe(item));
    const move = (event: PointerEvent) => {
      root.style.setProperty('--pointer-x', `${event.clientX}px`);
      root.style.setProperty('--pointer-y', `${event.clientY}px`);
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('pointermove', move);
    };
  }, []);
  return ref;
}

export default function HomeLandingSober() {
  const root = useMotion();
  const countdown = useCountdown();
  const [menu, setMenu] = useState(false);

  return (
    <div className="league" ref={root}>
      <Seo
        title="BTF — The Trading League"
        description="Entre dans les arènes BTF, grimpe au classement et gagne ta place pour la finale live à Paris."
        path="/v2"
        image={shots.finale}
      />
      <div className="league-noise" />
      <div className="league-pointer" />

      <header className="league-nav">
        <a href="/v2" className="league-logo"><img src="/landing/btf-logo-header.png" alt="BTF Arena" /><span>The trading league</span></a>
        <nav className={menu ? 'is-open' : ''}>
          <a href="#league" onClick={() => setMenu(false)}>La ligue</a>
          <a href="#ranking" onClick={() => setMenu(false)}>Classement</a>
          <a href="#traders" onClick={() => setMenu(false)}>Traders</a>
          <a href="#editions" onClick={() => setMenu(false)}>Éditions</a>
          <a href="#champions" onClick={() => setMenu(false)}>Champions</a>
        </nav>
        <div className="league-nav__actions">
          <a href="/compete" className="league-login">Connexion</a>
          <a href="/compete" className="league-btn is-small">S’inscrire</a>
          <button type="button" className="league-menu" onClick={() => setMenu((value) => !value)} aria-label="Menu"><i /><i /></button>
        </div>
      </header>

      <main>
        <section className="league-hero" id="league">
          <video src={`${film}#t=18`} poster={shots.arena} autoPlay muted loop playsInline preload="metadata" disablePictureInPicture />
          <div className="league-hero__shade" />
          <img className="league-hero__arena3d" src="/assets/pictures/arena3d.png" alt="" />
          <div className="league-hero__content" data-rise>
            <p>La nouvelle ère du trading compétitif</p>
            <h1>BTF</h1>
            <h2>The trading league</h2>
            <strong>1 marché. 1 arène. 1 champion.</strong>
            <div className="league-next">
              <small>Prochaine arène · lundi 08:00 UTC</small>
              <div>
                {Object.entries(countdown).map(([label, value]) => (
                  <span key={label}><b>{String(value).padStart(2, '0')}</b><em>{label}</em></span>
                ))}
              </div>
            </div>
            <div className="league-hero__actions">
              <a href="#archive" className="league-btn"><i>▶</i> Voir l’aftermovie</a>
              <a href="/compete" className="league-btn is-ghost">Entrer dans l’arène <Arrow /></a>
            </div>
          </div>
        </section>

        <section className="league-stats">
          <div><i className="is-live" /> <span>League feed</span><strong>Live</strong></div>
          <div><span>Prochaine arène</span><strong>Lun. 08:00 UTC</strong></div>
          <div><span>Traders inscrits</span><strong>8,742</strong></div>
          <div><span>Places pour Paris</span><strong>1 / saison</strong></div>
          <div><span>Marchés</span><strong className="is-green">Forex · Indices · Crypto</strong></div>
        </section>

        <section className="league-how">
          <header className="league-side-title" data-rise><h2>Comment<br />ça marche</h2><i /></header>
          <div className="league-how__steps">
            {[
              ['01', 'flag', 'Entre dans l’arène', 'Participe au challenge en ligne avec les mêmes règles que tous.'],
              ['02', 'rank', 'Grimpe au classement', 'Ton PnL alimente le classement live et ta saison.'],
              ['03', 'shield', 'Deviens numéro 1', 'Termine premier de la saison pour obtenir ton invitation.'],
              ['04', 'stage', 'Monte sur scène', 'Affronte les marchés devant le public à Paris.'],
            ].map(([number, icon, title, text], index) => (
              <article key={number} data-rise style={{ '--delay': `${index * 80}ms` } as CSSProperties}>
                <b>{number}</b><StageIcon type={icon as 'flag' | 'rank' | 'shield' | 'stage'} />
                <h3>{title}</h3><p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="league-road">
          <header className="league-side-title" data-rise>
            <h2>Road to<br />Paris</h2><i />
            <p>Des milliers de traders.<br />Un seul champion.</p>
            <a href="/compete">Voir le format complet</a>
          </header>
          <div className="league-road__funnel" data-rise>
            {[
              ['Arènes en ligne', '10,000+', 'Traders'],
              ['Classement saison', '100', 'Traders'],
              ['Finalistes', '20', 'Traders'],
              ['BTF Paris', '4', 'Traders'],
            ].map(([title, value, label], index) => (
              <div key={title} className={`road-stage is-${index + 1}`}>
                <span>{title}</span><b>{value}</b><small>{label}</small>
              </div>
            ))}
            <div className="road-champion">
              <img src="/assets/badges/Bronze.png" alt="" />
              <span>Champion</span><b>1</b><small>Qualifié</small>
            </div>
          </div>
        </section>

        <section className="league-editions" id="editions">
          <header className="league-side-title" data-rise><h2>Éditions<br />BTF</h2><i /></header>
          <div className="league-editions__cards" data-rise>
            <a href="#archive" className="edition-card">
              <img src={shots.stage} alt="BTF Paris 2026" />
              <div><span>BTF 01</span><small>Paris 2026</small><b>Terminé</b></div>
              <footer>Champion · Lucas Moreau</footer>
            </a>
            <article className="edition-card is-next">
              <img src={shots.crowd} alt="BTF 2027" />
              <div><span>BTF 02</span><small>Paris 2027</small><b>À venir</b></div>
              <footer>Qualification ouverte sur BTF Arena</footer>
            </article>
          </div>
          <div className="league-ranking" id="ranking" data-rise>
            <header><h3>Classement de saison</h3><a href="/compete/rank">Classement complet</a></header>
            <div className="league-ranking__head"><span>#</span><span>Trader</span><span>Pays</span><span>Points</span><span>V</span></div>
            {ranking.map((row) => (
              <div className="league-ranking__row" key={row[1]}>{row.map((value) => <span key={value}>{value}</span>)}</div>
            ))}
            <footer><span>Tu n’es pas encore classé</span><a href="/compete">Entrer dans l’arène <Arrow /></a></footer>
          </div>
        </section>

        <section className="league-seat">
          <header className="league-side-title" data-rise>
            <h2>Gagne<br />ta place.</h2><i />
            <p>Prouve ta maîtrise.<br />Prends la première place.<br />Rejoins l’élite.</p>
          </header>
          <div className="league-seat__visual" data-rise>
            <span className="seat-ring" />
            <img src="/assets/pictures/arena3d.png" alt="Arène BTF en 3D" />
          </div>
          <div className="league-seat__details" data-rise>
            <div><span>Prochaine arène</span><strong>Lundi · 08:00 UTC</strong></div>
            <div><span>Capital</span><strong>100,000 $</strong></div>
            <div><span>Format</span><strong>Challenge hebdomadaire</strong></div>
            <div><span>Objectif</span><strong>N°1 de la saison</strong></div>
            <a href="/compete" className="league-btn">Entrer dans l’arène <Arrow /></a>
          </div>
        </section>

        <section className="league-traders" id="traders">
          <header className="league-side-title" data-rise><h2>Top<br />traders</h2><i /><a href="/compete/rank">Voir tous</a></header>
          <div className="league-traders__rail">
            {traders.map((trader, index) => (
              <article key={trader.name} data-rise style={{ '--delay': `${index * 60}ms` } as CSSProperties}>
                <div><img src={trader.image} alt="" /><b>0{index + 1}</b></div>
                <h3>{trader.name}</h3><small>{trader.role}</small>
                <p><span>Win rate</span><strong>{trader.win}</strong></p>
              </article>
            ))}
          </div>
        </section>

        <section className="league-champions" id="champions">
          <header className="league-side-title" data-rise>
            <h2>Hall of<br />champions</h2><i />
            <p>Les légendes se construisent<br />dans l’arène.</p>
          </header>
          <article className="league-champions__hero" data-rise>
            <img src={shots.winner} alt="Champion BTF 2026" />
            <div><span>BTF 01 Champion</span><h3>Lucas Moreau</h3><small>Paris · 2026</small><a href="#archive">Voir les highlights ▶</a></div>
          </article>
          {[2, 3, 4].map((edition) => (
            <article className="league-champions__empty" key={edition} data-rise>
              <div className="trophy-3d">♛</div><span>BTF 0{edition} Champion</span><strong>Coming soon</strong>
            </article>
          ))}
        </section>

        <section id="archive" className="league-archive" data-rise>
          <video src={film} controls playsInline preload="metadata" poster={shots.finale} />
          <div><span>Archive officielle</span><h2>Revivez<br />BTF 2026.</h2><p>La première édition, la pression des marchés et le moment où un champion est né.</p></div>
        </section>

        <section className="league-final">
          <img src={shots.finale} alt="" />
          <div><h2>Tu penses pouvoir<br />les battre ?</h2><p>L’arène t’attend.</p></div>
          <a href="/compete" className="league-btn">Entrer dans la prochaine arène <Arrow /></a>
        </section>
      </main>

      <footer className="league-footer">
        <img src="/landing/btf-logo-header.png" alt="BTF" />
        <span>© 2026–2027 BTF · Trading simulé</span>
        <div><a href="/cgu">CGU</a><a href="/risques">Risques</a><a href="/confidentialite">Confidentialité</a></div>
      </footer>
    </div>
  );
}
