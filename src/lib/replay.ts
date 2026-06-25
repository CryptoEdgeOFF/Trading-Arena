/**
 * Moteur de replay des parties live.
 *
 * Principe : l'admin saisit les joueurs + leurs trades (marché, heure, taille,
 * fermeture), le serveur fournit les bougies 1m de la fenêtre du match, et ce
 * module reconstruit l'état complet du dashboard (PnL, classement, badges) à
 * n'importe quel instant `t` de la partie.
 *
 * Granularité : les prix sont interpolés SECONDE par seconde à l'intérieur de
 * chaque bougie 1m. On ne connaît pas le vrai chemin intra-minute — on simule
 * un parcours qui touche open/low/high/close avec ordre L/H pseudo-aléatoire
 * (seed fixe par paire + minute, reproductible au seek), segments de durée
 * égale (pas proportionnel au delta de prix), et un léger bruit dans [low,high].
 * Les PnL réalisés utilisent les prix d'entrée/sortie saisis (exacts) quand fournis.
 *
 * Tout est déterministe : un seek = recalcul du frame à t, sans dérive.
 */

import type {
  Badge,
  EventMode,
  MarketTicker,
  Player,
  Position,
  SpotlightTrade,
  TeamInfo,
  Trade,
} from '../stores/useGameStore';
import { pnlToAccountCcy } from '../utils/positionPnl';
import { engineSizeFromInput } from '../utils/positionSizing';

/* -------------------------------------------------------------------------- */
/*                                   Types                                    */
/* -------------------------------------------------------------------------- */

export interface ReplayCandle {
  time: number; // secondes epoch (début de la minute)
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ReplayPlayerInput {
  id: string;
  name: string;
  color: string;
  avatar?: string | null;
  /** Équipe (mode 4v4 uniquement). */
  team?: 'A' | 'B';
}

export interface ReplayTradeInput {
  id: string;
  playerId: string;
  pair: string;
  side: 'long' | 'short';
  /** Heure d'entrée (ms epoch). */
  entryTime: number;
  /** Prix d'entrée réel si connu — sinon interpolé depuis les bougies. */
  entryPrice?: number | null;
  /** Taille en unités de base (ex. 0.5 BTC, 2 lots NAS100). */
  size: number;
  leverage: number;
  /** Heure de sortie (ms). null/absent = position gardée jusqu'à la fin. */
  exitTime?: number | null;
  /** Prix de sortie réel si connu — sinon interpolé. */
  exitPrice?: number | null;
  /**
   * PnL final imposé (USD, **net**, frais déjà déduits) pour ce trade. Quand
   * fourni, le PnL affiché tombe EXACTEMENT sur cette valeur — aucun frais
   * supplémentaire n'est soustrait. Le prix de sortie est rétro-calculé pour
   * un glissement cohérent. Idéal pour recoller au PnL exact d'une vidéo.
   */
  finalPnl?: number | null;
}

export interface ReplayConfig {
  title?: string;
  startMs: number;
  endMs: number;
  eventMode: EventMode;
  teamNames?: { a: string; b: string };
  startingBalance: number;
  players: ReplayPlayerInput[];
  trades: ReplayTradeInput[];
}

export interface ReplayPackage {
  config: ReplayConfig;
  candles: Record<string, ReplayCandle[]>;
}

export interface ReplayFrame {
  players: Player[];
  market: Record<string, MarketTicker>;
}

/** Clé localStorage du package préparé par l'onglet admin Replay. */
export const REPLAY_PACKAGE_KEY = 'btf-replay-package';

/** Marqueur de version du moteur replay (diagnostic de chargement HMR/cache). */
export const REPLAY_ENGINE_VERSION = 'v6-forced-pnl-realpath';
if (typeof console !== 'undefined') {
  console.info(`[replay] moteur ${REPLAY_ENGINE_VERSION} chargé`);
}

/* -------------------------------------------------------------------------- */
/*                          Constantes (miroir serveur)                       */
/* -------------------------------------------------------------------------- */

/** Miroir de TAKER_FEE_RATE dans exchangePaperEngine.ts (crypto). */
const TAKER_FEE_RATE = 0.0004 / 3;
const FOREX_FEE_RATE = 0.00003;
const COMMODITY_FEE_RATE = 0.00003;
const INDEX_FEE_RATE = 0.00002;

function resolveFeeRate(pair: string): number {
  const p = pair.toUpperCase();
  if (p.startsWith('EUR/') || p.startsWith('GBP/') || p.startsWith('USD/JPY') || p.startsWith('USD/CHF')) {
    return FOREX_FEE_RATE;
  }
  if (p.startsWith('GOLD/') || p.startsWith('SILVER/') || p.startsWith('WTI/')) {
    return COMMODITY_FEE_RATE;
  }
  if (p.startsWith('NAS100/') || p.startsWith('SP500/') || p.startsWith('US30/')) {
    return INDEX_FEE_RATE;
  }
  return TAKER_FEE_RATE;
}

/** Miroir de BADGE_DEFS (server/types.ts) — uniquement le nécessaire au front. */
const BADGE_DEFS: Record<string, Omit<Badge, 'awardedAt'>> = {
  'first-blood': { type: 'first-blood', label: 'First Blood', description: "Premier trade de l'événement", icon: '🩸' },
  'whale-alert': { type: 'whale-alert', label: 'Whale Alert', description: 'Plus gros gain sur un trade clôturé', icon: '🐋' },
  sniper: { type: 'sniper', label: 'Sniper', description: 'Meilleur trade unique en %', icon: '🎯' },
  'diamond-hands': { type: 'diamond-hands', label: 'Diamond Hands', description: 'Plus longue position ouverte', icon: '💎' },
  'speed-demon': { type: 'speed-demon', label: 'Speed Demon', description: 'Plus grand nombre de trades', icon: '⚡' },
  'green-machine': { type: 'green-machine', label: 'Green Machine', description: 'Plus longue série gagnante', icon: '🟢' },
};

/** Miroir de BADGE_THRESHOLDS (playerManager.ts). */
const BADGE_THRESHOLDS: Record<string, number> = {
  'whale-alert': 50,
  'speed-demon': 5,
  'diamond-hands': 15,
  sniper: 2,
  'green-machine': 3,
};

/* -------------------------------------------------------------------------- */
/*                      Prix : interpolation intra-bougie                     */
/* -------------------------------------------------------------------------- */

interface PriceSeries {
  byBucket: Map<number, ReplayCandle>;
  sortedTimes: number[];
}

export class PriceIndex {
  private series = new Map<string, PriceSeries>();

  constructor(candles: Record<string, ReplayCandle[]>) {
    for (const [pair, bars] of Object.entries(candles)) {
      const sorted = [...bars].sort((a, b) => a.time - b.time);
      this.series.set(pair.toUpperCase(), {
        byBucket: new Map(sorted.map((bar) => [bar.time, bar])),
        sortedTimes: sorted.map((bar) => bar.time),
      });
    }
  }

  hasPair(pair: string): boolean {
    return this.series.has(pair.toUpperCase());
  }

  /**
   * Prix interpolé à l'instant t (ms). À l'intérieur d'une bougie 1m : chemin
   * synthétique reproductible (seed paire + minute) avec bruit léger.
   */
  priceAt(pair: string, tMs: number): number | null {
    const s = this.series.get(pair.toUpperCase());
    if (!s || s.sortedTimes.length === 0) return null;
    const tSec = tMs / 1000;
    const bucket = Math.floor(tSec / 60) * 60;

    const candle = s.byBucket.get(bucket);
    if (candle) {
      return interpolateInsideCandle(pair, candle, tSec - bucket);
    }

    // Minute absente (marché fermé / trou) → close de la dernière bougie avant t.
    const prevTime = lastTimeAtOrBefore(s.sortedTimes, bucket);
    if (prevTime != null) {
      const prev = s.byBucket.get(prevTime);
      if (prev) return prev.close;
    }
    // Avant la première bougie → open de la première.
    const first = s.byBucket.get(s.sortedTimes[0]);
    return first ? first.open : null;
  }
}

/** Plus grand time <= target (binary search). */
function lastTimeAtOrBefore(sorted: number[], target: number): number | null {
  let lo = 0;
  let hi = sorted.length - 1;
  let best: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= target) {
      best = sorted[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/** Hash déterministe pour seeds reproductibles (seek / pause sans flicker). */
function hashU32(...parts: (string | number)[]): number {
  let h = 2_166_136_261;
  for (const part of parts) {
    const text = String(part);
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16_777_619);
    }
  }
  return h >>> 0;
}

function pseudoRandom(seed: number): number {
  let t = (seed + 0x6D2B79F5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), (t | 61) >>> 0);
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
}

const PRICE_EPS = 1e-9;

function nearPrice(a: number, b: number): boolean {
  return Math.abs(a - b) <= PRICE_EPS;
}

/**
 * Simule un prix intra-bougie plus « vivant » que O→L→H→C linéaire :
 * - ordre de visite low/high tiré au sort (seed fixe par paire + barre) ;
 * - chaque segment dure la même fraction de la minute (pas liée au delta prix) ;
 * - micro-bruit seconde par seconde, clampé dans [low, high].
 */
function interpolateInsideCandle(pair: string, candle: ReplayCandle, secInto: number): number {
  const sec = Math.max(0, Math.min(59.999, secInto));
  const { open, high, low, close, time: barTime } = candle;
  const range = high - low;

  if (range <= PRICE_EPS) return open;

  const mids: number[] = [];
  if (!nearPrice(low, open) && !nearPrice(low, close)) mids.push(low);
  if (!nearPrice(high, open) && !nearPrice(high, close) && !nearPrice(high, low)) mids.push(high);

  const orderSeed = hashU32(pair, barTime, 'path');
  if (mids.length === 2 && pseudoRandom(orderSeed) > 0.5) {
    mids.reverse();
  }

  const path = [open, ...mids, close];
  const segments = path.length - 1;
  if (segments <= 0) return open;

  const segDuration = 60 / segments;
  const segIndex = Math.min(segments - 1, Math.floor(sec / segDuration));
  const u = segDuration > 0 ? (sec - segIndex * segDuration) / segDuration : 0;
  const from = path[segIndex];
  const to = path[segIndex + 1];
  let price = from + (to - from) * u;

  // Léger bruit ± ~3 % du range, reproductible par seconde (pas de flicker au
  // seek). Volontairement faible : amplifié par le contract size (US30 ×5,
  // SP500 ×50…), un bruit trop fort ferait sauter le PnL de centaines de $.
  const jitterSeed = hashU32(pair, barTime, Math.floor(sec));
  const noise = (pseudoRandom(jitterSeed) - 0.5) * range * 0.06;
  price = Math.min(high, Math.max(low, price + noise));

  return price;
}

/* -------------------------------------------------------------------------- */
/*                        Préparation des trades résolus                      */
/* -------------------------------------------------------------------------- */

export interface ResolvedTrade {
  input: ReplayTradeInput;
  entryPrice: number;
  exitPrice: number | null; // null = jamais fermé (reste ouvert jusqu'à la fin)
  exitTime: number | null;
  /** Taille en unités moteur (lots saisis × contract size MT5). US30 : ×5. */
  engineSize: number;
  feeOpen: number;
  feeClose: number;
  realizedPnl: number; // 0 si pas de close
  /** true si entrée ET sortie ont été saisies (prix de marché explicites). */
  pricesProvided: boolean;
}

/** Devise de cotation d'une paire (ex. "USD" pour NAS100/USD). */
function quoteOf(pair: string): string {
  return (pair.split('/')[1] || '').toUpperCase();
}

/**
 * Rétro-calcule le prix de sortie qui produit EXACTEMENT `targetPnl` (USD) pour
 * la position donnée. Permet de forcer le PnL final d'un trade tout en gardant
 * un glissement de mark cohérent (entrée → sortie synthétique → PnL imposé).
 * Retourne null si non résoluble (dénominateur ~0 / prix négatif).
 */
function solveExitPriceForPnl(
  pair: string,
  side: 'long' | 'short',
  entryPrice: number,
  engineSize: number,
  targetPnl: number,
): number | null {
  if (engineSize <= 0 || entryPrice <= 0) return null;
  const quote = quoteOf(pair);
  const usdQuote = !quote || quote === 'USD';

  let exitPrice: number;
  if (usdQuote) {
    // targetPnl = ±(exit - entry) × size
    exitPrice = side === 'long'
      ? entryPrice + targetPnl / engineSize
      : entryPrice - targetPnl / engineSize;
  } else {
    // targetPnl = ±(exit - entry) × size / exit   (conversion quote → USD)
    const denom = side === 'long' ? engineSize - targetPnl : engineSize + targetPnl;
    if (Math.abs(denom) < 1e-9) return null;
    exitPrice = (engineSize * entryPrice) / denom;
  }
  if (!Number.isFinite(exitPrice) || exitPrice <= 0) return null;
  return exitPrice;
}

/**
 * Résout les prix manquants (interpolation) et précalcule frais + PnL réalisé.
 * Les trades dont la paire n'a pas de bougies sont ignorés (signalés).
 */
export function resolveTrades(
  config: ReplayConfig,
  prices: PriceIndex,
): { resolved: ResolvedTrade[]; skipped: string[] } {
  const resolved: ResolvedTrade[] = [];
  const skipped: string[] = [];

  for (const input of config.trades) {
    const pair = input.pair.toUpperCase();
    if (!prices.hasPair(pair)) {
      skipped.push(`${pair} (pas de bougies)`);
      continue;
    }
    const entryProvided = Boolean(input.entryPrice && input.entryPrice > 0);
    const entryPrice = entryProvided
      ? (input.entryPrice as number)
      : prices.priceAt(pair, input.entryTime);
    if (!entryPrice || entryPrice <= 0) {
      skipped.push(`${pair} @ ${new Date(input.entryTime).toLocaleTimeString()} (prix d'entrée introuvable)`);
      continue;
    }

    // La taille saisie est en LOTS pour les paires TradFi (US30, NAS100…),
    // en unités natives pour la crypto. On convertit en unités moteur comme
    // le terminal live (engineSizeFromInput), sinon le PnL est faux d'un
    // facteur = contract size (US30 = ×5).
    const engineSize = engineSizeFromInput(pair, input.size);

    // PnL final imposé : le trade tombe pile sur cette valeur, peu importe les
    // prix/spread/frais. Si aucune heure de sortie n'est saisie, on clôture à
    // la fin de la partie (sinon le PnL "final" n'aurait pas de sens).
    const forcedPnl = input.finalPnl != null && Number.isFinite(input.finalPnl)
      ? (input.finalPnl as number)
      : null;

    const hasExit = input.exitTime != null && Number.isFinite(input.exitTime);
    const exitTime = hasExit
      ? Math.min(input.exitTime as number, config.endMs)
      : (forcedPnl != null ? config.endMs : null);

    let exitPrice: number | null = null;
    let exitProvided = false;
    if (exitTime != null) {
      if (forcedPnl != null) {
        // Prix de sortie rétro-calculé pour atterrir exactement sur le PnL
        // imposé (glissement de mark cohérent). Fallback : prix saisi/interpolé.
        const solved = solveExitPriceForPnl(pair, input.side, entryPrice, engineSize, forcedPnl);
        exitPrice = solved
          ?? (input.exitPrice && input.exitPrice > 0 ? (input.exitPrice as number) : prices.priceAt(pair, exitTime));
        exitProvided = true;
      } else {
        exitProvided = Boolean(input.exitPrice && input.exitPrice > 0);
        exitPrice = exitProvided
          ? (input.exitPrice as number)
          : prices.priceAt(pair, exitTime);
      }
    }

    const feeRate = resolveFeeRate(pair);
    // PnL forcé = net (frais déjà inclus dans la valeur saisie) → pas de double
    // déduction dans computeFrame (equity = realized − feesPaid).
    const feesIncluded = forcedPnl != null && exitTime != null;
    const feeOpen = feesIncluded ? 0 : entryPrice * engineSize * feeRate;
    const feeClose = feesIncluded || exitPrice == null ? 0 : exitPrice * engineSize * feeRate;
    let realizedPnl = 0;
    if (forcedPnl != null && exitTime != null) {
      // PnL net exact imposé (priorité absolue sur le calcul par prix).
      realizedPnl = forcedPnl;
    } else if (exitPrice != null) {
      const raw = input.side === 'long'
        ? (exitPrice - entryPrice) * engineSize
        : (entryPrice - exitPrice) * engineSize;
      realizedPnl = pnlToAccountCcy(pair, raw, exitPrice);
    }

    resolved.push({
      input: { ...input, pair },
      entryPrice,
      exitPrice,
      exitTime,
      engineSize,
      feeOpen,
      feeClose,
      realizedPnl,
      pricesProvided: entryProvided && exitProvided,
    });
  }

  resolved.sort((a, b) => a.input.entryTime - b.input.entryTime);
  return { resolved, skipped };
}

/* -------------------------------------------------------------------------- */
/*                              Frame à l'instant t                           */
/* -------------------------------------------------------------------------- */

function emptyPlayer(input: ReplayPlayerInput, startingBalance: number): Player {
  return {
    id: input.id,
    name: input.name,
    color: input.color,
    avatar: input.avatar ?? null,
    active: true,
    initialBalance: startingBalance,
    currentBalance: startingBalance,
    availableMargin: startingBalance,
    usedMargin: 0,
    feesPaid: 0,
    pnl: 0,
    pnlPercent: 0,
    tradeCount: 0,
    trades: [],
    openPositions: [],
    openOrders: [],
    rank: 0,
    previousRank: 0,
    badges: [],
    winStreak: 0,
    longestPositionMinutes: 0,
    biggestTradePnl: 0,
    bestTradePercent: 0,
    lastUpdate: Date.now(),
    connected: true,
  };
}

/**
 * Reconstruit l'état complet de tous les joueurs + tickers marché à l'instant
 * `tMs` de la partie. Déterministe (utilisé aussi pour le seek).
 */
export function computeFrame(
  config: ReplayConfig,
  resolved: ResolvedTrade[],
  prices: PriceIndex,
  tMs: number,
): ReplayFrame {
  const t = Math.max(config.startMs, Math.min(tMs, config.endMs));
  const players = new Map<string, Player>();
  for (const input of config.players) {
    players.set(input.id, emptyPlayer(input, config.startingBalance));
  }

  const pairsUsed = new Set<string>();

  for (const trade of resolved) {
    const player = players.get(trade.input.playerId);
    if (!player) continue;
    if (trade.input.entryTime > t) continue;
    pairsUsed.add(trade.input.pair);

    const isClosed = trade.exitTime != null && trade.exitTime <= t && trade.exitPrice != null;

    // --- Trade d'ouverture (journal) ---
    player.tradeCount += 1;
    player.feesPaid += trade.feeOpen;
    player.trades.push({
      id: `${trade.input.id}:open`,
      playerName: player.name,
      playerColor: player.color,
      pair: trade.input.pair,
      side: trade.input.side,
      size: trade.engineSize,
      price: trade.entryPrice,
      fee: trade.feeOpen,
      leverage: trade.input.leverage,
      orderType: 'market',
      pnl: 0,
      time: trade.input.entryTime,
      action: 'open',
    });

    if (isClosed) {
      // --- Clôturé avant t : PnL réalisé + métriques badges ---
      player.feesPaid += trade.feeClose;
      player.trades.push({
        id: `${trade.input.id}:close`,
        playerName: player.name,
        playerColor: player.color,
        pair: trade.input.pair,
        side: trade.input.side,
        size: trade.engineSize,
        price: trade.exitPrice as number,
        fee: trade.feeClose,
        leverage: trade.input.leverage,
        orderType: 'market',
        pnl: trade.realizedPnl,
        time: trade.exitTime as number,
        action: 'close',
      });

      const holdMinutes = ((trade.exitTime as number) - trade.input.entryTime) / 60_000;
      if (holdMinutes > player.longestPositionMinutes) {
        player.longestPositionMinutes = holdMinutes;
      }
      const notional = trade.entryPrice * trade.engineSize;
      const tradePercent = notional > 0 ? (trade.realizedPnl / notional) * 100 : 0;
      if (tradePercent > player.bestTradePercent) player.bestTradePercent = tradePercent;
      if (trade.realizedPnl > player.biggestTradePnl) player.biggestTradePnl = trade.realizedPnl;
    } else {
      // --- Encore ouvert à t : position vivante ---
      // On suit TOUJOURS le mouvement réel des bougies, ancré au prix d'entrée
      // (vrais hauts/bas, retournements, mèches…). Le mark = entrée + variation
      // réelle du marché depuis l'entrée.
      const markRaw = prices.priceAt(trade.input.pair, t) ?? trade.entryPrice;
      const anchor = prices.priceAt(trade.input.pair, trade.input.entryTime) ?? trade.entryPrice;
      const mark = trade.entryPrice + (markRaw - anchor);
      const raw = trade.input.side === 'long'
        ? (mark - trade.entryPrice) * trade.engineSize
        : (trade.entryPrice - mark) * trade.engineSize;
      let pnl = pnlToAccountCcy(trade.input.pair, raw, mark);

      // PnL final imposé : on garde la FORME réelle des bougies, mais on ajoute
      // une dérive linéaire pour que le latent converge EXACTEMENT vers la cible
      // au moment du close (au lieu d'un glissement plat sans retournement).
      const forced = trade.input.finalPnl;
      if (forced != null && Number.isFinite(forced) && trade.exitTime != null) {
        const exitRaw = prices.priceAt(trade.input.pair, trade.exitTime) ?? trade.entryPrice;
        const markExit = trade.entryPrice + (exitRaw - anchor);
        const rawExit = trade.input.side === 'long'
          ? (markExit - trade.entryPrice) * trade.engineSize
          : (trade.entryPrice - markExit) * trade.engineSize;
        const latentExit = pnlToAccountCcy(trade.input.pair, rawExit, markExit);
        const span = trade.exitTime - trade.input.entryTime;
        const u = span > 0
          ? Math.max(0, Math.min(1, (t - trade.input.entryTime) / span))
          : 1;
        // À u=0 → 0 ; à u=1 → latentExit + (cible − latentExit) = cible.
        pnl = pnl + (forced - latentExit) * u;
      }

      const margin = (trade.entryPrice * trade.engineSize) / Math.max(1, trade.input.leverage);
      const position: Position = {
        id: trade.input.id,
        pair: trade.input.pair,
        side: trade.input.side,
        size: trade.engineSize,
        entryPrice: trade.entryPrice,
        markPrice: mark,
        pnl,
        unrealizedFunding: 0,
        leverage: trade.input.leverage,
        margin,
        feesPaid: trade.feeOpen,
        liquidationPrice: null,
        stopLoss: null,
        takeProfit: null,
        openedAt: trade.input.entryTime,
      };
      player.openPositions.push(position);
    }
  }

  // --- Win streaks : closes en ordre chronologique par joueur ---
  for (const player of players.values()) {
    const closes = player.trades
      .filter((trade) => trade.action === 'close')
      .sort((a, b) => a.time - b.time);
    let streak = 0;
    for (const close of closes) {
      streak = close.pnl > 0 ? streak + 1 : 0;
    }
    player.winStreak = streak;
  }

  // --- Equity (miroir de updatePlayerEquity serveur) ---
  for (const player of players.values()) {
    const realized = player.trades
      .filter((trade) => trade.action === 'close')
      .reduce((total, trade) => total + trade.pnl, 0);
    const unrealized = player.openPositions.reduce((total, position) => total + position.pnl, 0);
    const initial = player.initialBalance ?? config.startingBalance;
    player.usedMargin = player.openPositions.reduce((total, position) => total + position.margin, 0);
    player.currentBalance = initial + realized + unrealized - player.feesPaid;
    player.availableMargin = Math.max(0, player.currentBalance - player.usedMargin);
    player.pnl = player.currentBalance - initial;
    player.pnlPercent = initial > 0 ? (player.pnl / initial) * 100 : 0;
    player.lastUpdate = Date.now();
  }

  assignBadges(players, resolved, t);

  // --- Classement (tri pnlPercent comme le serveur) ---
  const ranked = [...players.values()].sort((a, b) => b.pnlPercent - a.pnlPercent);
  ranked.forEach((player, index) => {
    player.rank = index + 1;
  });

  // --- Tickers marché ---
  const market: Record<string, MarketTicker> = {};
  for (const pair of pairsUsed) {
    const mark = prices.priceAt(pair, t);
    if (!mark) continue;
    market[pair] = {
      pair,
      symbol: pair,
      markPrice: mark,
      bidPrice: mark * (1 - 0.00001),
      askPrice: mark * (1 + 0.00001),
      change24h: null,
      spreadBps: 0.2,
      updatedAt: Date.now(),
      marketOpen: true,
    };
  }

  return { players: ranked, market };
}

/** Attribution des badges, miroir des règles live (seuils + leader strict). */
function assignBadges(
  players: Map<string, Player>,
  resolved: ResolvedTrade[],
  tMs: number,
): void {
  // First Blood : premier open de la partie.
  const firstTrade = resolved.find((trade) => trade.input.entryTime <= tMs);
  if (firstTrade) {
    const owner = players.get(firstTrade.input.playerId);
    if (owner) {
      owner.badges.push({ ...BADGE_DEFS['first-blood'], awardedAt: firstTrade.input.entryTime });
    }
  }

  // Badges compétitifs : un seul détenteur, score >= seuil, pas d'égalité au sommet.
  const competitive: Array<{ type: string; score: (player: Player) => number }> = [
    { type: 'whale-alert', score: (player) => player.biggestTradePnl },
    { type: 'speed-demon', score: (player) => player.tradeCount },
    { type: 'diamond-hands', score: (player) => player.longestPositionMinutes },
    { type: 'sniper', score: (player) => player.bestTradePercent },
    { type: 'green-machine', score: (player) => player.winStreak },
  ];
  const all = [...players.values()];
  for (const { type, score } of competitive) {
    const min = BADGE_THRESHOLDS[type] ?? 0;
    let best: Player | null = null;
    let bestScore = -Infinity;
    let tie = false;
    for (const player of all) {
      const value = score(player);
      if (value > bestScore) {
        bestScore = value;
        best = player;
        tie = false;
      } else if (value === bestScore && value > 0) {
        tie = true;
      }
    }
    if (best && !tie && bestScore >= min) {
      best.badges.push({ ...BADGE_DEFS[type], awardedAt: tMs });
    }
  }
}

/* -------------------------------------------------------------------------- */
/*                       Helpers événements (diff de frames)                  */
/* -------------------------------------------------------------------------- */

/** Construit le SpotlightTrade correspondant à un trade du journal. */
export function tradeToSpotlight(trade: Trade, player: Player, entryPrice: number): SpotlightTrade {
  return {
    id: trade.id,
    playerName: player.name,
    playerColor: player.color,
    playerAvatar: player.avatar,
    pair: trade.pair,
    side: trade.side,
    size: trade.size,
    entryPrice,
    action: trade.action === 'close' ? 'close' : 'open',
    pnl: trade.pnl,
    reason: 'manual',
  };
}

/** Équipes 4v4 à partir des inputs joueurs. */
export function buildTeams(config: ReplayConfig): [TeamInfo, TeamInfo] | null {
  if (config.eventMode !== '4v4') return null;
  const teamA = config.players.filter((player) => player.team !== 'B').map((player) => player.id);
  const teamB = config.players.filter((player) => player.team === 'B').map((player) => player.id);
  return [
    { name: config.teamNames?.a || 'Équipe A', color: '#3b82f6', playerIds: teamA },
    { name: config.teamNames?.b || 'Équipe B', color: '#ef4444', playerIds: teamB },
  ];
}
