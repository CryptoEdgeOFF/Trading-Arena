import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import Seo, { SITE_URL } from './Seo';
import './HomeLanding.css';

const media = '/landing/btf2026';

const photos = {
  stage: `${media}/20260604_ElliotLeCorre_Veiga_092023.webp`,
  crowd: `${media}/20260604_ElliotLeCorre_Veiga_123857.webp`,
  player: `${media}/20260604_ElliotLeCorre_Veiga_154719.webp`,
  action: `${media}/20260604_ElliotLeCorre_Veiga_154748.webp`,
  desk: `${media}/20260604_ElliotLeCorre_Veiga_154907.webp`,
  night: `${media}/20260604_ElliotLeCorre_Veiga_181728.webp`,
  host: `${media}/20260605_ElliotLeCorre_Veiga_152405.webp`,
  panel: `${media}/20260605_ElliotLeCorre_Veiga_154940.webp`,
  victory: `${media}/20260605_ElliotLeCorre_Veiga_181516.webp`,
  family: `${media}/20260605_ElliotLeCorre_Veiga_194001.webp`,
};

const aftermovie = '/landing/btf2026-aftermovie.mp4';

const leagueShots = [
  { src: photos.host, alt: 'Présentation sur la scène BTF 2026 à Paris' },
  { src: photos.stage, alt: 'Scène de compétition BTF 2026 à Paris' },
  { src: photos.crowd, alt: 'Public de la ligue BTF pendant l’événement Paris 2026' },
  { src: photos.player, alt: 'Trader en compétition live sur la scène BTF' },
  { src: photos.action, alt: 'Battle de trading en direct BTF 2026' },
  { src: photos.desk, alt: 'Traders au desk pendant BTF 2026' },
  { src: photos.panel, alt: 'Panel et debrief BTF 2026' },
  { src: photos.victory, alt: 'Moment de victoire BTF 2026 à Paris' },
];

const fighters = [
  {
    first: 'Nada', last: 'FX', role: 'SNIPER', ovr: 91, stamina: 84,
    photo: '/assets/Players/Nada.png', accent: '#ff304f',
    number: '01', style: 'Précision chirurgicale', country: 'FRANCE',
    bio: 'Patiente, méthodique, létale. Nada construit ses positions comme un sniper et frappe quand le setup ne laisse plus de place au doute.',
    stats: { AGG: 78, DIS: 90, RSK: 72, SPD: 81, MND: 93, EXE: 94 },
  },
  {
    first: 'Benjamin', last: 'Mauger', role: 'ATK', ovr: 88, stamina: 79,
    photo: '/assets/Players/Benjamin.png', accent: '#ff643d',
    number: '02', style: 'Pression maximale', country: 'FRANCE',
    bio: 'Un style frontal et explosif. Benjamin impose son rythme, attaque les mouvements forts et ne laisse jamais respirer le marché.',
    stats: { AGG: 92, DIS: 74, RSK: 88, SPD: 90, MND: 80, EXE: 86 },
  },
  {
    first: 'Corentin', last: 'Trading', role: 'CTRL', ovr: 86, stamina: 88,
    photo: '/assets/Players/Corentin.png', accent: '#65d579',
    number: '03', style: 'Contrôle du tempo', country: 'FRANCE',
    bio: 'Lecture froide, gestion propre, exécution constante. Corentin ralentit le combat et oblige ses adversaires à jouer sur son terrain.',
    stats: { AGG: 68, DIS: 93, RSK: 64, SPD: 70, MND: 89, EXE: 85 },
  },
  {
    first: 'Romain', last: 'Bailleul', role: 'SWING', ovr: 85, stamina: 76,
    photo: '/assets/Players/Romain.png', accent: '#4387ff',
    number: '04', style: 'Vision long range', country: 'FRANCE',
    bio: 'Romain accepte le temps long pour capturer les grands mouvements. Une approche patiente, engagée et construite pour durer.',
    stats: { AGG: 86, DIS: 71, RSK: 91, SPD: 83, MND: 77, EXE: 80 },
  },
];

function circularPlayerOffset(index: number, activeIndex: number) {
  let offset = index - activeIndex;
  if (offset > fighters.length / 2) offset -= fighters.length;
  if (offset < -fighters.length / 2) offset += fighters.length;
  return offset;
}

const roadSteps = [
  { tag: 'ENTER', title: 'Entre dans l’arène', text: 'Crée ton profil et prends place dans la ligue.', meta: 'ACCÈS GRATUIT', icon: 'user' },
  { tag: 'CLIMB', title: 'Grimpe au ranking', text: 'Chaque semaine, ton PnL écrit ta position.', meta: 'ARÈNES OFFICIELLES', icon: 'swords' },
  { tag: 'CONQUER', title: 'Prends la saison', text: 'Termine devant tous les autres traders.', meta: '1 SEUL LEADER', icon: 'crown' },
  { tag: 'PARIS', title: 'Monte sur scène', text: 'Le champion décroche son ticket pour le live BTF 2027.', meta: 'INVITATION OFFICIELLE', icon: 'ticket', featured: true },
];

function RoadIcon({ name }: { name: string }) {
  if (name === 'user') {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="10" r="5" /><path d="M6 26c1.6-6 6-9 10-9s8.4 3 10 9" /></svg>
    );
  }
  if (name === 'swords') {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 25 21 11l2 2L9 27l-3 1zM22 8l2 2 3-3-2-2zM10 22l2 2" /><path d="M25 7 11 21l-2-2L23 5l3 1zM8 24l-2-2-3 3 2 2zM22 10l-2-2" /></svg>
    );
  }
  if (name === 'crown') {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 13 10 19 16 8l6 11 5-6v10H5zM7 25h18" /></svg>
    );
  }
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 10h14l4 4v12H7z" /><path d="M11 10V8h6v2M12 18h8M12 22h5" /></svg>
  );
}

function MediaImg({
  src,
  alt,
  width = 1800,
  height = 1200,
  priority = false,
  className,
}: {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  priority?: boolean;
  className?: string;
}) {
  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
      decoding="async"
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
    />
  );
}

export default function HomeLanding() {
  const [shot, setShot] = useState(0);
  const [playerIndex, setPlayerIndex] = useState(0);
  const playerTouchX = useRef<number | null>(null);
  const previousPlayerOffsets = useRef(
    fighters.map((_, index) => circularPlayerOffset(index, 0)),
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      setShot((current) => (current + 1) % leagueShots.length);
    }, 3800);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPlayerIndex((current) => (current + 1) % fighters.length);
    }, 5200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    previousPlayerOffsets.current = fighters.map((_, index) => circularPlayerOffset(index, playerIndex));
  }, [playerIndex]);

  const movePlayer = (direction: number) => {
    setPlayerIndex((current) => (current + direction + fighters.length) % fighters.length);
  };

  const playerOffset = (index: number) => {
    return circularPlayerOffset(index, playerIndex);
  };

  return (
    <div className="league league-main">
      <Seo
        title="BTF 2027 — La ligue esport du trading"
        description="BTF transforme le trading en compétition esport. Joue les arènes, monte au classement et qualifie-toi pour Paris 2027."
        path="/"
        image={`${SITE_URL}${photos.family}`}
        keywords="BTF, BTF Arena, BTF 2027, trading fight league, compétition trading, esport trading Paris"
        jsonLd={[
          {
            '@context': 'https://schema.org',
            '@type': 'SportsEvent',
            name: 'BTF 2027',
            description: 'Prochain grand événement de la ligue BTF à Paris. Qualification via BTF Arena.',
            eventStatus: 'https://schema.org/EventScheduled',
            image: `${SITE_URL}${photos.stage}`,
            location: { '@type': 'Place', name: 'Paris, France' },
            organizer: { '@type': 'Organization', name: 'BTF', url: SITE_URL },
          },
          {
            '@context': 'https://schema.org',
            '@type': 'VideoObject',
            name: 'BTF 2026 Aftermovie',
            description: 'Aftermovie officiel de la première édition BTF à Paris, les 4 et 5 juin 2026.',
            thumbnailUrl: `${SITE_URL}${photos.family}`,
            uploadDate: '2026-06-05',
            contentUrl: `${SITE_URL}${aftermovie}`,
          },
        ]}
      />

      <header className="league-nav">
        <a className="league-brand" href="/" aria-label="BTF">
          <MediaImg src="/assets/pictures/btf-dashboard.webp" alt="Logo BTF" width={200} height={200} priority />
        </a>
        <nav>
          <a href="#league">La ligue</a>
          <a href="#road">Qualifications</a>
          <a href="#players">Players</a>
          <a href="#btf2026">BTF 2026</a>
          <a href="#app">App</a>
        </nav>
        <a className="fight-btn fight-btn--red league-nav__cta" href="/compete">BTF Arena</a>
      </header>

      <main>
        <section className="league-hero">
          <video
            src={`${aftermovie}#t=19`}
            poster={photos.action}
            title="Aftermovie BTF 2026"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            disablePictureInPicture
          />
          <div className="league-hero__shade" />
          <div className="league-hero__grid" aria-hidden="true" />
          <div className="league-hero__copy">
            <p className="fight-kicker"><i /> FRANCE BORN · WORLD BOUND</p>
            <h1><span>TRADING</span><strong>IS A SPORT.</strong></h1>
            <p className="league-hero__lead">BTF est la ligue française qui transforme le trading en esport : des traders comme athlètes, des marchés comme terrain de jeu et des événements live pensés comme de grands combats.</p>
            <div className="fight-actions">
              <a className="fight-btn fight-btn--red fight-btn--xl" href="/compete">Entrer dans la ligue</a>
              <a className="fight-btn fight-btn--dark fight-btn--xl" href="#btf2026"><span>▶</span> Voir BTF 2026</a>
            </div>
          </div>
        </section>

        <div className="hero-sponsors">
          <span>PARTENAIRES OFFICIELS</span>
          <div className="hero-sponsors__window">
            <div className="hero-sponsors__track">
              {[0, 1, 2, 3].map((index) => (
                <div className="hero-sponsors__set" key={index} aria-hidden={index > 0}>
                  <img src="/assets/pictures/kraken-logo-white.webp" alt={index === 0 ? 'Kraken' : ''} width={150} height={50} loading="lazy" decoding="async" />
                  <i />
                  <img src="/assets/pictures/ninjatrader-logo.webp" alt={index === 0 ? 'NinjaTrader' : ''} width={150} height={50} loading="lazy" decoding="async" />
                  <i />
                  <img src="/assets/pictures/Blocks.png" alt={index === 0 ? 'Blocks' : ''} width={150} height={50} loading="lazy" decoding="async" />
                  <i />
                  <img src="/assets/pictures/Breakout%20TV%20BTF.png" alt={index === 0 ? 'Breakout TV' : ''} width={150} height={50} loading="lazy" decoding="async" />
                  <i />
                </div>
              ))}
            </div>
          </div>
        </div>

        <section className="league-manifesto fight-wrap" id="league">
          <div className="league-manifesto__copy">
            <p className="fight-kicker"><i /> THIS IS BTF</p>
            <h2>LA PREMIÈRE<br />TRADING <em>FIGHT LEAGUE</em><br />FRANÇAISE.</h2>
            <p>Nous construisons un sport autour de la performance de trading. Un format simple à suivre, spectaculaire à vivre et capable de réunir une communauté internationale autour des meilleurs traders.</p>
            <blockquote>« Chaque trader mérite sa scène, son classement et son moment de gloire. »</blockquote>
          </div>
          <div className="league-manifesto__visual">
            {leagueShots.map((item, index) => (
              <MediaImg
                key={item.src}
                src={item.src}
                alt={item.alt}
                priority={index === 0}
                className={index === shot ? 'is-on' : undefined}
              />
            ))}
            <span>THE<br />LEAGUE</span>
            <small>BORN IN FRANCE<br />BUILT FOR THE WORLD</small>
          </div>
        </section>

        <section className="road" id="road">
          <div className="road__backdrop" aria-hidden="true">
            <MediaImg src={photos.stage} alt="" width={1800} height={1200} />
          </div>
          <div className="road__grid" aria-hidden="true" />
          <div className="road__shell fight-wrap">
            <header className="road__heading">
              <div>
                <p className="fight-kicker"><i /> ROAD TO BTF 2027</p>
                <h2>LE CLASSEMENT<br />EST TON <em>BILLET.</em></h2>
              </div>
              <div className="road__brief">
                <strong>04</strong>
                <span>ÉTAPES.<br />UNE PLACE.</span>
                <p>Pas de candidature. Pas de jury. Ta performance sur BTF Arena peut t’emmener jusqu’aux projecteurs de Paris.</p>
              </div>
            </header>

            <div className="road-track">
              <div className="road-track__rail" aria-hidden="true"><i /></div>
              {roadSteps.map((step, index) => (
                <article
                  className={step.featured ? 'road-step is-ticket' : 'road-step'}
                  key={step.tag}
                >
                  <div className="road-step__node" aria-hidden="true"><i /><b>0{index + 1}</b></div>
                  <div className="road-step__card">
                    <div className="road-icon" aria-hidden="true"><RoadIcon name={step.icon} /></div>
                    <span>{step.tag}</span>
                    <h3>{step.title}</h3>
                    <p>{step.text}</p>
                    <small>{step.meta}</small>
                  </div>
                </article>
              ))}
              <div className="road-track__finish" aria-hidden="true">
                <span>PARIS</span>
                <b>2027</b>
                <i>LIVE STAGE</i>
              </div>
            </div>

            <footer className="road__footer">
              <p><span>●</span> LA COURSE EST OUVERTE</p>
              <a className="fight-btn fight-btn--red" href="/compete">Commencer ma route <b>↗</b></a>
            </footer>
          </div>
        </section>

        <section className="league-players" id="players">
          <div className="players-noise" aria-hidden="true" />
          <header className="players-heading fight-wrap">
            <div>
              <p className="fight-kicker"><i /> MEET THE FIGHTERS</p>
              <h2>LES FIGHTERS<br /><em>DE LA SAISON 2026.</em></h2>
            </div>
            <p>Quatre styles. Quatre lectures du marché. Une même scène. Découvre les traders qui ont lancé la première saison BTF.</p>
          </header>

          <div
            className="player-showcase"
            style={{ '--fighter-accent': fighters[playerIndex].accent } as CSSProperties}
            onTouchStart={(event) => { playerTouchX.current = event.touches[0]?.clientX ?? null; }}
            onTouchEnd={(event) => {
              if (playerTouchX.current == null) return;
              const delta = event.changedTouches[0]?.clientX - playerTouchX.current;
              if (Math.abs(delta) > 45) movePlayer(delta < 0 ? 1 : -1);
              playerTouchX.current = null;
            }}
          >
            <div className="player-showcase__halo" aria-hidden="true" />
            <div className="player-showcase__cards">
              {fighters.map((fighter, index) => {
                const offset = playerOffset(index);
                const teleportsBehind = Math.abs(offset - previousPlayerOffsets.current[index]) > 1;
                const hiddenBehind = Math.abs(offset) >= 2;
                return (
                  <button
                    className={`fighter-card${offset === 0 ? ' is-active' : ''}${teleportsBehind ? ' is-teleport' : ''}${hiddenBehind ? ' is-behind' : ''}`}
                    style={{
                      '--player-offset': offset,
                      '--player-depth': Math.abs(offset),
                      '--player-z': 10 - Math.abs(offset),
                      '--player-x': `${offset * 24}vw`,
                      '--player-x-mobile': `${offset * 66}vw`,
                      '--player-z-shift': `${Math.abs(offset) * -150}px`,
                      '--player-rotate': `${offset * -18}deg`,
                      '--player-scale': 1 - Math.abs(offset) * 0.13,
                      '--player-opacity': hiddenBehind ? 0 : 1 - Math.abs(offset) * 0.26,
                      '--fighter-accent': fighter.accent,
                    } as CSSProperties}
                    type="button"
                    onClick={() => setPlayerIndex(index)}
                    aria-label={`Afficher ${fighter.first} ${fighter.last}`}
                    aria-current={offset === 0 ? 'true' : undefined}
                    key={fighter.last}
                  >
                    <div className="fighter-card__graphic" aria-hidden="true">
                      <span>{fighter.number}</span>
                      <i />
                      <small>BTF // SEASON 2026</small>
                    </div>
                    <MediaImg src={fighter.photo} alt={`${fighter.first} ${fighter.last}, trader BTF 2026`} width={720} height={900} />
                    <div className="fighter-card__shade" />
                    <div className="fighter-card__top">
                      <span>{fighter.role}</span>
                      <b>{fighter.ovr}</b>
                    </div>
                    <div className="fighter-card__name">
                      <small>{fighter.first}</small>
                      <strong>{fighter.last}</strong>
                    </div>
                    <div className="fighter-card__stats">
                      {Object.entries(fighter.stats).slice(0, 3).map(([key, value]) => (
                        <span key={key}><small>{key}</small><b>{value}</b></span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>

            <button className="player-arrow player-arrow--prev" type="button" onClick={() => movePlayer(-1)} aria-label="Player précédent">←</button>
            <button className="player-arrow player-arrow--next" type="button" onClick={() => movePlayer(1)} aria-label="Player suivant">→</button>
          </div>

          <div
            className="player-profile fight-wrap"
            style={{ '--fighter-accent': fighters[playerIndex].accent } as CSSProperties}
            aria-live="polite"
          >
            <div className="player-profile__identity">
              <span>{fighters[playerIndex].number} / 04</span>
              <h3>{fighters[playerIndex].first} <strong>{fighters[playerIndex].last}</strong></h3>
              <small>{fighters[playerIndex].role} · {fighters[playerIndex].country}</small>
            </div>
            <div className="player-profile__story">
              <span>STYLE DE COMBAT</span>
              <strong>{fighters[playerIndex].style}</strong>
              <p>{fighters[playerIndex].bio}</p>
            </div>
            <div className="player-profile__meter">
              <span>STAMINA</span>
              <b>{fighters[playerIndex].stamina}</b>
              <i><em style={{ width: `${fighters[playerIndex].stamina}%` }} /></i>
            </div>
            <div className="player-dots" aria-label="Choisir un player">
              {fighters.map((fighter, index) => (
                <button
                  className={index === playerIndex ? 'is-on' : undefined}
                  type="button"
                  onClick={() => setPlayerIndex(index)}
                  aria-label={fighter.last}
                  key={fighter.last}
                />
              ))}
            </div>
          </div>
        </section>

        <section className="league-film" id="btf2026">
          <header className="fight-heading fight-wrap">
            <p className="fight-kicker"><i /> BTF 2026</p>
            <h2>REVIVRE<br /><em>LA COMPÉTITION.</em></h2>
            <p>Le replay intégral de BTF 2026 sera bientôt disponible.</p>
          </header>
          <div className="film-trigger film-trigger--soon fight-wrap">
            <MediaImg src={photos.family} alt="Miniature du replay de la compétition BTF 2026 à Paris" priority={false} />
            <span>BIENTÔT DISPONIBLE</span>
            <small>REPLAY INTÉGRAL · BTF 2026</small>
          </div>
        </section>

        <section className="league-app fight-wrap" id="app">
          <header className="fight-heading">
            <p className="fight-kicker"><i /> MOBILE</p>
            <h2>TÉLÉCHARGE<br /><em>L’APP.</em></h2>
            <p>BTF Arena sur iOS et Android. Tes arènes, ton rang, ton live, dans la poche.</p>
          </header>
          <div className="app-shots">
            <MediaImg
              className="app-shots__wide"
              src="/assets/pictures/appli%20large.png"
              alt="Télécharger l’application BTF Arena sur iOS et Android"
              width={1008}
              height={347}
            />
          </div>
          <div className="fight-actions app-actions">
            <a className="fight-btn fight-btn--red fight-btn--xl" href="/compete">Ouvrir BTF Arena</a>
            <span>iOS · Android</span>
          </div>
        </section>

        <section className="league-partners">
          <p>PARTENAIRES DE L’ÉCOSYSTÈME BTF</p>
          <div>
            <a href="https://www.kraken.com/sign-up" target="_blank" rel="noreferrer"><img src="/assets/pictures/kraken-logo-white.webp" alt="Kraken" width={240} height={96} loading="lazy" decoding="async" /></a>
            <a href="https://ninjatrader.com/GetStarted" target="_blank" rel="noreferrer"><img src="/assets/pictures/ninjatrader-logo.webp" alt="NinjaTrader" width={240} height={96} loading="lazy" decoding="async" /></a>
            <img src="/assets/pictures/Blocks.png" alt="Blocks" width={240} height={96} loading="lazy" decoding="async" />
            <img src="/assets/pictures/Breakout%20TV%20BTF.png" alt="Breakout TV" width={240} height={96} loading="lazy" decoding="async" />
          </div>
        </section>
      </main>

      <footer className="league-footer">
        <a className="league-brand" href="/" aria-label="BTF">
          <MediaImg src="/assets/pictures/btf-dashboard.webp" alt="Logo BTF" width={200} height={200} />
        </a>
        <nav>
          <a href="#league">La ligue</a>
          <a href="#players">Players</a>
          <a href="#btf2026">BTF 2026</a>
          <a href="/compete">BTF Arena</a>
        </nav>
        <p>© 2026–2027 BTF · Born in France. Built for the world.<br />Les compétitions en ligne utilisent du trading simulé.</p>
      </footer>
    </div>
  );
}
