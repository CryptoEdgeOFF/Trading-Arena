import crypto from 'crypto';
import WebSocket from 'ws';
import type { MarketDataSource, MarketTicker, Order, OrderType, Player, Position, SpotlightTrade, Trade } from './types.js';
import * as kraken from './kraken.js';
import * as binance from './binance.js';
import * as hyperliquid from './hyperliquid.js';
import * as engineCandlesCache from './engineCandlesCache.js';
import { ITICK_INSTRUMENTS } from './itickInstruments.js';
import { itickFeed } from './itick.js';
import { pnlToAccountCcy } from './pairFx.js';
import { assertMarketOpen, getMarketSessionForPair } from './marketHours.js';

export interface PaperOrderInput {
  pair: string;
  side: 'long' | 'short';
  size: number;
  orderType: OrderType;
  limitPrice?: number | null;
  leverage: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
}

export interface PaperOrderResult {
  trade: Trade;
  spotlight: SpotlightTrade;
}

/**
 * Quote injectée dans le paper engine par les sources externes (iTick).
 * Format générique pour découpler le moteur de la source amont.
 */
export interface ExternalQuote {
  pair: string;
  sourceSymbol: string;
  markPrice: number;
  bidPrice: number;
  askPrice: number;
  updatedAt: number;
}

type PaperPairSource = 'kraken_futures' | 'itick';
type PaperPairDef = {
  pair: string;
  source: PaperPairSource;
  sourceSymbol: string;
  krakenSymbol?: string;
  hyperliquidCoin?: string;
  binanceSymbol?: string;
};

const cryptoPair = (pair: string, krakenSymbol: string, hyperliquidCoin: string, binanceSymbol?: string): PaperPairDef => ({
  pair,
  source: 'kraken_futures',
  sourceSymbol: krakenSymbol,
  krakenSymbol,
  hyperliquidCoin,
  binanceSymbol: binanceSymbol || binance.pairToBinanceSymbol(pair) || undefined,
});

const itickPaperPair = (pair: string, code: string, hlCoin?: string | null): PaperPairDef => ({
  pair,
  source: 'itick',
  sourceSymbol: code,
  hyperliquidCoin: hlCoin || undefined,
});

export const PAPER_PAIRS: PaperPairDef[] = [
  cryptoPair('BTC/USD', 'PF_XBTUSD', 'BTC'),
  cryptoPair('ETH/USD', 'PF_ETHUSD', 'ETH'),
  cryptoPair('XRP/USD', 'PF_XRPUSD', 'XRP'),
  cryptoPair('BNB/USD', 'PF_BNBUSD', 'BNB'),
  cryptoPair('SOL/USD', 'PF_SOLUSD', 'SOL'),
  cryptoPair('DOGE/USD', 'PF_DOGEUSD', 'DOGE'),
  cryptoPair('ADA/USD', 'PF_ADAUSD', 'ADA'),
  cryptoPair('TRX/USD', 'PF_TRXUSD', 'TRX'),
  cryptoPair('LINK/USD', 'PF_LINKUSD', 'LINK'),
  cryptoPair('AVAX/USD', 'PF_AVAXUSD', 'AVAX'),
  cryptoPair('XLM/USD', 'PF_XLMUSD', 'XLM'),
  cryptoPair('BCH/USD', 'PF_BCHUSD', 'BCH'),
  cryptoPair('DOT/USD', 'PF_DOTUSD', 'DOT'),
  cryptoPair('LTC/USD', 'PF_LTCUSD', 'LTC'),
  cryptoPair('SUI/USD', 'PF_SUIUSD', 'SUI'),
  cryptoPair('HBAR/USD', 'PF_HBARUSD', 'HBAR'),
  cryptoPair('TON/USD', 'PF_TONUSD', 'TON'),
  cryptoPair('SHIB/USD', 'PF_SHIBUSD', 'SHIB'),
  cryptoPair('UNI/USD', 'PF_UNIUSD', 'UNI'),
  cryptoPair('AAVE/USD', 'PF_AAVEUSD', 'AAVE'),
  cryptoPair('NEAR/USD', 'PF_NEARUSD', 'NEAR'),
  cryptoPair('APT/USD', 'PF_APTUSD', 'APT'),
  cryptoPair('ICP/USD', 'PF_ICPUSD', 'ICP'),
  cryptoPair('ETC/USD', 'PF_ETCUSD', 'ETC'),
  cryptoPair('POL/USD', 'PF_POLUSD', 'POL'),
  cryptoPair('FET/USD', 'PF_FETUSD', 'FET'),
  cryptoPair('RENDER/USD', 'PF_RENDERUSD', 'RENDER'),
  cryptoPair('ONDO/USD', 'PF_ONDOUSD', 'ONDO'),
  cryptoPair('FIL/USD', 'PF_FILUSD', 'FIL'),
  cryptoPair('ARB/USD', 'PF_ARBUSD', 'ARB'),
  cryptoPair('ATOM/USD', 'PF_ATOMUSD', 'ATOM'),
  cryptoPair('OP/USD', 'PF_OPUSD', 'OP'),
  cryptoPair('INJ/USD', 'PF_INJUSD', 'INJ'),
  cryptoPair('WLD/USD', 'PF_WLDUSD', 'WLD'),
  cryptoPair('SEI/USD', 'PF_SEIUSD', 'SEI'),
  cryptoPair('IMX/USD', 'PF_IMXUSD', 'IMX'),
  cryptoPair('GRT/USD', 'PF_GRTUSD', 'GRT'),
  cryptoPair('ALGO/USD', 'PF_ALGOUSD', 'ALGO'),
  cryptoPair('SAND/USD', 'PF_SANDUSD', 'SAND'),
  cryptoPair('MANA/USD', 'PF_MANAUSD', 'MANA'),
  cryptoPair('QNT/USD', 'PF_QNTUSD', 'QNT'),
  cryptoPair('STX/USD', 'PF_STXUSD', 'STX'),
  cryptoPair('LDO/USD', 'PF_LDOUSD', 'LDO'),
  cryptoPair('RUNE/USD', 'PF_RUNEUSD', 'RUNE'),
  cryptoPair('APE/USD', 'PF_APEUSD', 'APE'),
  cryptoPair('PENDLE/USD', 'PF_PENDLEUSD', 'PENDLE'),
  cryptoPair('TIA/USD', 'PF_TIAUSD', 'TIA'),
  cryptoPair('JUP/USD', 'PF_JUPUSD', 'JUP'),
  cryptoPair('PYTH/USD', 'PF_PYTHUSD', 'PYTH'),
  cryptoPair('BONK/USD', 'PF_BONKUSD', 'BONK'),
  ...ITICK_INSTRUMENTS.map((inst) => itickPaperPair(inst.pair, inst.code, inst.hyperliquidCoin)),
];

/** Demi-spread autour du mark pour l'exécution paper (bid/ask). 0,001 %
 *  par côté (0,1 bps) → ~0,002 % aller-retour. Le mark affiché (chart,
 *  PnL flottant) reste le mid iTick = TradingView. */
const SPREAD_BPS = 0.1;
// Même barème que la compétition online, divisé par 3.
const TAKER_FEE_RATE = 0.00005 / 3; // ~0,00167 % — ordres au marché
const MAKER_FEE_RATE = 0.00002 / 3; // ~0,00067 % — ordres limites
const MAX_LEVERAGE = 50;
const MIN_LEVERAGE = 1;
/** Notional minimal d'un ordre (anti-spam de positions "dust"). */
const MIN_ORDER_NOTIONAL = 0.01;
const KRAKEN_FUTURES_WS = 'wss://futures.kraken.com/ws/v1';
const BINANCE_FUTURES_WS = 'wss://fstream.binance.com/stream?streams=';
const BYBIT_LINEAR_WS = 'wss://stream.bybit.com/v5/public/linear';
/**
 * Bybit linear est utilisé en FAILOVER quand Binance fstream est
 * silencieusement geo-bloqué chez le provider (la WS connecte, ne pousse
 * aucun message → BTC reste figé puis saute toutes les 5s via REST).
 *
 * Comportement :
 *  - Binance markPrice@1s reste la source primaire (1 Hz, comportement
 *    fluide identique à ce qui tournait avant la session).
 *  - Bybit tourne en parallèle MAIS son flush n'écrit le prix que pour
 *    les pairs où Binance n'a rien poussé depuis BYBIT_TAKEOVER_MS.
 *  - Flush coalescé à 1 Hz pour rester aligné sur le rythme Binance et
 *    éviter la vibration de la dernière bougie.
 */
const BYBIT_FLUSH_INTERVAL_MS = 1000;
const BYBIT_TAKEOVER_MS = 3000;
/**
 * iTick crypto (region BA = spot Binance = TradingView) est la source
 * PRIMAIRE des prix crypto. Kraken Futures et Bybit ne servent plus que de
 * failover : ils n'écrivent un prix que si iTick n'a rien poussé depuis
 * `ITICK_CRYPTO_TAKEOVER_MS`. `ITICK_CRYPTO_STALE_MS` borne la fraîcheur
 * acceptée par le snapshot REST périodique.
 */
const ITICK_CRYPTO_TAKEOVER_MS = 3000;
const ITICK_CRYPTO_STALE_MS = 10_000;

/** Pairs crypto (source kraken_futures) qu'on alimente en live via iTick. */
export const CRYPTO_LIVE_PAIRS = PAPER_PAIRS
  .filter((item) => item.source === 'kraken_futures')
  .map((item) => item.pair);

/** "BTC/USD" ↔ "BTCUSDT" (code crypto iTick, region BA). */
const cryptoPairToItickCode = new Map<string, string>();
for (const pair of CRYPTO_LIVE_PAIRS) {
  const base = pair.split('/')[0]?.trim().toUpperCase();
  if (base) cryptoPairToItickCode.set(pair, `${base}USDT`);
}

const pairToDefinition = new Map(PAPER_PAIRS.map((item) => [item.pair, item]));
const pairToKrakenSymbol = new Map(PAPER_PAIRS.filter((item) => item.krakenSymbol).map((item) => [item.pair, item.krakenSymbol as string]));
const symbolToPair = new Map(PAPER_PAIRS.filter((item) => item.krakenSymbol).map((item) => [item.krakenSymbol as string, item.pair]));
const symbolToBinancePair = new Map(PAPER_PAIRS.filter((item) => item.binanceSymbol).map((item) => [item.binanceSymbol as string, item.pair]));
// Bybit USDT-perp utilise les mêmes symboles que Binance USDT-perp pour les
// principales pairs (BTCUSDT, ETHUSDT…), donc on réutilise la map Binance.
const bybitSymbolToPair = symbolToBinancePair;

function computePositionPnl(position: Position): number {
  const rawPnl = position.side === 'long'
    ? (position.markPrice - position.entryPrice) * position.size
    : (position.entryPrice - position.markPrice) * position.size;
  // Pair en USD (BTC/USD, GOLD/USD, …) : rawPnl est déjà en USD.
  // Pair USD/JPY ou USD/CHF : rawPnl est en JPY/CHF, on convertit
  // au mark price courant (cohérent avec le PnL flottant MT5).
  return pnlToAccountCcy(position.pair, rawPnl, position.markPrice);
}

/** Bid/ask paper : demi-spread symétrique autour du mark (chart = mid). */
function applyPaperMarkSpread(markPrice: number): { bidPrice: number; askPrice: number } {
  const halfSpread = markPrice * (SPREAD_BPS / 10000);
  return {
    bidPrice: Math.max(0, markPrice - halfSpread),
    askPrice: markPrice + halfSpread,
  };
}

function withMarketSession(ticker: MarketTicker): MarketTicker {
  const session = getMarketSessionForPair(ticker.pair);
  return {
    ...ticker,
    marketOpen: session.open,
    marketClosedLabel: session.open ? null : session.label,
  };
}

function validateRiskLevels(
  side: 'long' | 'short',
  referencePrice: number,
  stopLoss: number | null,
  takeProfit: number | null,
): void {
  if (stopLoss != null) {
    if (!Number.isFinite(stopLoss) || stopLoss <= 0) {
      throw new Error('Stop loss invalide');
    }
    if (side === 'long' && stopLoss >= referencePrice) {
      throw new Error('Le stop loss doit etre sous le prix d\'entree pour un long');
    }
    if (side === 'short' && stopLoss <= referencePrice) {
      throw new Error('Le stop loss doit etre au-dessus du prix d\'entree pour un short');
    }
  }
  if (takeProfit != null) {
    if (!Number.isFinite(takeProfit) || takeProfit <= 0) {
      throw new Error('Take profit invalide');
    }
    if (side === 'long' && takeProfit <= referencePrice) {
      throw new Error('Le take profit doit etre au-dessus du prix d\'entree pour un long');
    }
    if (side === 'short' && takeProfit >= referencePrice) {
      throw new Error('Le take profit doit etre sous le prix d\'entree pour un short');
    }
  }
}

function getRealizedPnl(player: Player): number {
  return player.trades
    .filter((trade) => trade.action === 'close')
    .reduce((total, trade) => total + trade.pnl, 0);
}

function getReservedCapital(player: Player): number {
  return player.openOrders.reduce((total, order) => total + order.marginReserved + order.feeEstimate, 0);
}

function clampLeverage(value: number): number {
  if (!Number.isFinite(value)) return MIN_LEVERAGE;
  return Math.max(MIN_LEVERAGE, Math.min(MAX_LEVERAGE, Math.floor(value)));
}

function asNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

/**
 * Pendant les `LIMIT_WARMUP_MS` premières millisecondes après un boot,
 * `processOpenOrders` ignore les ordres limites pour éviter qu'un tick
 * iTick stale (premier batch reçu après reconnect WS) ne déclenche une
 * exécution sur un mark price erroné. Une fois le warmup terminé, le
 * matching reprend normalement à chaque applyTicker / applyItickQuotes.
 */
const LIMIT_WARMUP_MS = 10_000;

export class PaperTradingEngine {
  private market: Record<string, MarketTicker> = {};
  /** Intervalle REST de secours quand le WS public est down. */
  private tickerInterval: ReturnType<typeof setInterval> | null = null;
  private bootedAt = Date.now();
  private websocket: WebSocket | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  /**
   * WS Bybit linear toujours actif pour la fluidité crypto des charts,
   * indépendamment de `marketDataSource`. Pousse ~10 Hz par pair, on
   * coalesce à 80 ms.
   */
  private bybitWebsocket: WebSocket | null = null;
  private bybitReconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private bybitReconnectAttempts = 0;
  private bybitPingInterval: ReturnType<typeof setInterval> | null = null;
  private bybitPendingPairs = new Set<string>();
  private bybitFlushTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * Buffer du dernier prix Bybit reçu par pair, en attente d'écriture.
   * On n'écrit dans `this.market` que si Binance n'a pas fourni de tick
   * récent pour la même pair (failover) — sinon Bybit ferait vibrer la
   * dernière bougie inutilement.
   */
  private bybitLatest = new Map<string, { price: number; bid: number; askPrice: number; symbol: string; change24h: number | null; ts: number }>();
  /** Timestamp du dernier tick reçu par pair, source réelle confondue. */
  private lastTickAt = new Map<string, number>();
  /** Timestamp du dernier tick iTick crypto par pair (source primaire). */
  private lastItickCryptoAt = new Map<string, number>();
  private playersRef: Player[] = [];
  private startingBalance = 10_000;
  private marketDataSource: MarketDataSource = 'kraken';
  private onTick: () => void;
  private onMarketPairsUpdated: ((pairs: string[]) => void) | null = null;
  /** Feed marché public (charts) — indépendant d'une session de trading active. */
  private marketFeedActive = false;
  /**
   * File des spotlights générés par le moteur lui-même (déclenchements
   * SL/TP automatiques). Drainée par le PlayerManager à chaque tick.
   */
  private engineSpotlights: SpotlightTrade[] = [];
  /**
   * Verrou par joueur : sérialise les mutations financières (ouverture /
   * fermeture de position) d'un même joueur. Sans ça, deux requêtes
   * concurrentes peuvent s'intercaler autour de l'`await refreshTickers()`
   * et passer deux fois le contrôle de marge → double dépense du capital.
   */
  private playerLocks = new Map<string, Promise<unknown>>();

  private withPlayerLock<T>(playerId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.playerLocks.get(playerId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(fn);
    // On garde la dernière promesse en chaîne ; on nettoie quand c'est la
    // dernière pour éviter une fuite mémoire sur les joueurs inactifs.
    this.playerLocks.set(playerId, next);
    void next.catch(() => undefined).finally(() => {
      if (this.playerLocks.get(playerId) === next) {
        this.playerLocks.delete(playerId);
      }
    });
    return next;
  }

  constructor(onTick: () => void, onMarketPairsUpdated?: (pairs: string[]) => void) {
    this.onTick = onTick;
    this.onMarketPairsUpdated = onMarketPairsUpdated ?? null;
  }

  /**
   * Démarre (ou maintient) le flux prix crypto Kraken/Binance pour les
   * charts, même sans compétition active. Les pairs iTick restent gérées
   * par le bridge iTick côté index.ts.
   */
  async ensureMarketFeed(): Promise<void> {
    if (this.marketFeedActive) return;
    this.marketFeedActive = true;
    try {
      await this.refreshTickers(this.playersRef);
    } catch (error) {
      console.warn('[paper] ensureMarketFeed bootstrap failed:', (error as Error).message);
    }
    this.startMarketFeed();
    this.startMarketFeedFallback();
    // Bybit en FAILOVER : démarre la WS, mais le flush n'écrit pas dans
    // `this.market` tant que Binance pousse normalement (cf.
    // `flushBybitPending` + `BYBIT_TAKEOVER_MS`). Garde le chart vivant
    // sur Railway si fstream.binance.com est silencieusement bloqué,
    // sans casser la fluidité 1 Hz quand Binance fonctionne.
    if (process.env.DISABLE_BYBIT_FEED !== 'true') {
      this.startBybitTickerSocket();
    }
  }

  /** Récupère et vide la file des spotlights produits par le moteur. */
  drainEngineSpotlights(): SpotlightTrade[] {
    if (this.engineSpotlights.length === 0) return [];
    const out = this.engineSpotlights;
    this.engineSpotlights = [];
    return out;
  }

  setStartingBalance(balance: number): void {
    this.startingBalance = balance;
  }

  getStartingBalance(): number {
    return this.startingBalance;
  }

  getSupportedPairs(): string[] {
    return this.getActivePairDefs().map((item) => item.pair);
  }

  getMarketSnapshot(): Record<string, MarketTicker> {
    return Object.fromEntries(
      Object.entries(this.market).map(([pair, ticker]) => [pair, withMarketSession(ticker)]),
    );
  }

  async refreshMarketSnapshot(): Promise<Record<string, MarketTicker>> {
    await this.refreshTickers(this.playersRef);
    return this.market;
  }

  /**
   * Fast path pour les ticks externes (iTick) : met à jour les quotes
   * en mémoire sans appeler Kraken/Binance. Retourne les pairs dont le
   * ticker a effectivement changé.
   */
  applyItickQuotes(quotes: Record<string, ExternalQuote>): string[] {
    const changed: string[] = [];
    const now = Date.now();

    for (const [pair, quote] of Object.entries(quotes)) {
      const pairDef = PAPER_PAIRS.find((item) => item.pair === pair);
      if (!pairDef) continue;
      // Forex/indices = source itick. Crypto = source kraken_futures mais
      // désormais alimentée en live par iTick crypto (region BA = spot
      // Binance = TradingView), Kraken/Bybit en failover.
      const isCrypto = pairDef.source === 'kraken_futures';
      if (pairDef.source !== 'itick' && !isCrypto) continue;

      const prev = this.market[pair];
      const markPrice = quote.markPrice;
      if (!Number.isFinite(markPrice) || markPrice <= 0) continue;

      const { bidPrice, askPrice } = applyPaperMarkSpread(markPrice);
      const updatedAt = quote.updatedAt || now;

      // Crypto : marque iTick comme source primaire (gèle Kraken/Bybit) et
      // tient la bougie courante du cache à jour, même si le prix n'a pas
      // bougé depuis le dernier tick.
      if (isCrypto) {
        this.lastItickCryptoAt.set(pair, now);
        this.lastTickAt.set(pair, now);
        engineCandlesCache.updateLastCandleFromTick(pair, markPrice, updatedAt);
      }

      if (
        prev
        && prev.markPrice === markPrice
        && prev.bidPrice === bidPrice
        && prev.askPrice === askPrice
        && prev.updatedAt === updatedAt
      ) {
        continue;
      }

      this.market[pair] = {
        pair,
        symbol: prev?.symbol ?? pairDef.sourceSymbol,
        markPrice,
        bidPrice,
        askPrice,
        change24h: prev?.change24h ?? null,
        spreadBps: markPrice > 0 ? ((askPrice - bidPrice) / markPrice) * 10000 : SPREAD_BPS,
        updatedAt,
      };
      changed.push(pair);
    }

    if (changed.length === 0) return changed;

    this.processOpenOrders(this.playersRef);
    this.processRiskTriggers(this.playersRef);

    for (const player of this.playersRef) {
      this.updatePlayerEquity(player);
      player.connected = true;
      player.lastUpdate = now;
    }

    this.onTick();
    return changed;
  }

  private getActivePairDefs(): PaperPairDef[] {
    if (this.marketDataSource === 'binance') {
      return PAPER_PAIRS.filter((item) => Boolean(item.binanceSymbol) || item.source === 'itick');
    }
    return PAPER_PAIRS;
  }

  getFeeRates() {
    return {
      maker: MAKER_FEE_RATE,
      taker: TAKER_FEE_RATE,
      spreadBps: SPREAD_BPS,
      minLeverage: MIN_LEVERAGE,
      maxLeverage: MAX_LEVERAGE,
    };
  }

  setMarketDataSource(source: MarketDataSource): void {
    const changed = this.marketDataSource !== source;
    this.marketDataSource = source;
    if (!changed) return;
    if (this.marketFeedActive || this.playersRef.length > 0) {
      this.startMarketFeed();
      this.refreshTickers(this.playersRef).catch((error) => {
        console.error('Paper source switch refresh failed:', (error as Error).message);
      });
    }
  }

  getMarketDataSource(): MarketDataSource {
    return this.marketDataSource;
  }

  trackPlayers(players: Player[]): void {
    const known = new Set(this.playersRef.map((player) => player.id));
    for (const player of players) {
      if (!known.has(player.id)) {
        this.playersRef.push(player);
        known.add(player.id);
      }
    }
  }

  async start(players: Player[], options: { reset?: boolean } = {}): Promise<void> {
    this.stopSession();
    this.playersRef = players;
    if (options.reset !== false) {
      this.resetPlayers(players);
    }
    if (!this.marketFeedActive) {
      await this.ensureMarketFeed();
    } else {
      await this.refreshTickers(players);
    }

    // Low-frequency fallback keeps the market alive if the public WS drops.
    if (!this.tickerInterval) {
      this.startMarketFeedFallback();
    }
  }

  /** Arrête la session de trading sans couper le feed marché public. */
  stopSession(): void {
    this.playersRef = [];
  }

  /** Arrête tout, y compris le feed marché (shutdown serveur). */
  stop(): void {
    this.stopSession();
    this.stopMarketFeed();
  }

  private stopMarketFeed(): void {
    this.marketFeedActive = false;
    if (this.tickerInterval) {
      clearInterval(this.tickerInterval);
      this.tickerInterval = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.websocket) {
      this.websocket.removeAllListeners();
      this.websocket.close();
      this.websocket = null;
    }
    this.reconnectAttempts = 0;
    this.stopBybitTickerSocket();
  }

  private stopBybitTickerSocket(): void {
    if (this.bybitFlushTimer) {
      clearInterval(this.bybitFlushTimer);
      this.bybitFlushTimer = null;
    }
    if (this.bybitPingInterval) {
      clearInterval(this.bybitPingInterval);
      this.bybitPingInterval = null;
    }
    if (this.bybitReconnectTimeout) {
      clearTimeout(this.bybitReconnectTimeout);
      this.bybitReconnectTimeout = null;
    }
    if (this.bybitWebsocket) {
      this.bybitWebsocket.removeAllListeners();
      this.bybitWebsocket.close();
      this.bybitWebsocket = null;
    }
    this.bybitPendingPairs.clear();
    this.bybitReconnectAttempts = 0;
  }

  private startMarketFeedFallback(): void {
    if (this.tickerInterval) return;
    const fallbackMs = this.marketDataSource === 'binance' ? 5000 : 30000;
    this.tickerInterval = setInterval(() => {
      const cryptoPairs = this.getActivePairDefs()
        .filter((item) => item.source !== 'itick')
        .map((item) => item.pair);
      this.refreshTickers(this.playersRef)
        .then(() => {
          const updated = cryptoPairs.filter((pair) => (this.market[pair]?.markPrice ?? 0) > 0);
          if (updated.length > 0) this.onMarketPairsUpdated?.(updated);
        })
        .catch((error) => {
          console.error('Paper fallback ticker refresh failed:', (error as Error).message);
        });
    }, fallbackMs);
    if (typeof this.tickerInterval.unref === 'function') {
      this.tickerInterval.unref();
    }
  }

  async placeOrder(player: Player, input: PaperOrderInput): Promise<PaperOrderResult> {
    return this.withPlayerLock(player.id, () => this.placeOrderLocked(player, input));
  }

  private async placeOrderLocked(player: Player, input: PaperOrderInput): Promise<PaperOrderResult> {
    const pair = input.pair;
    const side = input.side;
    const size = Number(input.size);
    const orderType = input.orderType;
    const leverage = clampLeverage(Number(input.leverage));
    const pairDefinition = pairToDefinition.get(pair);

    // Trace tout placeOrder pour pouvoir corréler avec les logs Railway
    // si une position "fantôme" apparaît : on a la pair, le side, le size,
    // et l'identité du player. Si jamais quelque chose appelle placeOrder
    // sans clic utilisateur, on le verra ici avec la stack trace.
    console.log(
      `[paper] placeOrder ${player.name} ${pair} ${side} ${orderType} `
      + `size=${size} leverage=${leverage} `
      + `limit=${input.limitPrice ?? '–'} sl=${input.stopLoss ?? '–'} tp=${input.takeProfit ?? '–'}`,
    );

    if (!pairDefinition) throw new Error('Pair non supportée');
    assertMarketOpen(pair);
    if (side !== 'long' && side !== 'short') throw new Error('Sens d’ordre invalide');
    if (!Number.isFinite(size) || size <= 0) throw new Error('Taille de position invalide');
    if (!['market', 'limit'].includes(orderType)) throw new Error('Type d’ordre invalide');
    if (!this.market[pair]) {
      await this.refreshTickers([player]);
    }
    const ticker = this.market[pair];
    if (!ticker) throw new Error('Prix de marché indisponible');

    const inputStopLoss = input.stopLoss == null ? null : Number(input.stopLoss);
    const inputTakeProfit = input.takeProfit == null ? null : Number(input.takeProfit);

    if (orderType === 'market') {
      const executionPrice = side === 'long' ? ticker.askPrice : ticker.bidPrice;
      if (executionPrice * size < MIN_ORDER_NOTIONAL) {
        throw new Error('Taille de position trop faible');
      }
      validateRiskLevels(side, executionPrice, inputStopLoss, inputTakeProfit);
      return this.executeOrder(player, {
        id: crypto.randomUUID(),
        pair,
        side,
        size,
        orderType,
        status: 'filled',
        limitPrice: null,
        leverage,
        marginReserved: 0,
        feeEstimate: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        stopLoss: inputStopLoss,
        takeProfit: inputTakeProfit,
      }, executionPrice, TAKER_FEE_RATE);
    }

    const limitPrice = Number(input.limitPrice);
    if (!Number.isFinite(limitPrice) || limitPrice <= 0) {
      throw new Error('Prix limite invalide');
    }
    if (limitPrice * size < MIN_ORDER_NOTIONAL) {
      throw new Error('Taille de position trop faible');
    }

    validateRiskLevels(side, limitPrice, inputStopLoss, inputTakeProfit);

    const notional = limitPrice * size;
    const marginRequired = notional / leverage;
    const feeEstimate = notional * MAKER_FEE_RATE;
    if (marginRequired + feeEstimate > player.availableMargin) {
      throw new Error(`Capital disponible insuffisant (${player.availableMargin.toFixed(2)}$)`);
    }

    const now = Date.now();
    const order: Order = {
      id: crypto.randomUUID(),
      pair,
      side,
      size,
      orderType,
      status: 'open',
      limitPrice,
      leverage,
      marginReserved: marginRequired,
      feeEstimate,
      createdAt: now,
      updatedAt: now,
      stopLoss: inputStopLoss,
      takeProfit: inputTakeProfit,
    };

    player.openOrders.push(order);
    this.updatePlayerEquity(player);

    return {
      trade: {
        id: order.id,
        playerName: player.name,
        playerColor: player.color,
        pair,
        side,
        size,
        price: limitPrice,
        fee: 0,
        leverage,
        orderType,
        pnl: 0,
        time: now,
        action: 'update',
      },
      spotlight: {
        id: order.id,
        playerName: player.name,
        playerColor: player.color,
        playerAvatar: player.avatar,
        pair,
        side,
        size,
        entryPrice: limitPrice,
        action: 'open',
        pnl: 0,
      },
    };
  }

  async closePosition(player: Player, positionRef: string, partialSize?: number): Promise<PaperOrderResult> {
    return this.withPlayerLock(player.id, () => this.closePositionLocked(player, positionRef, partialSize));
  }

  private async closePositionLocked(player: Player, positionRef: string, partialSize?: number): Promise<PaperOrderResult> {
    const existing = player.openPositions.find((position) => position.id === positionRef)
      ?? player.openPositions.find((position) => position.pair === positionRef);
    if (!existing) {
      throw new Error('Position introuvable');
    }

    const pair = existing.pair;
    assertMarketOpen(pair);
    if (!this.market[pair]) {
      await this.refreshTickers([player]);
    }
    const ticker = this.market[pair];
    if (!ticker) throw new Error('Prix de marché indisponible');

    let sizeToClose = existing.size;
    let isPartial = false;
    if (partialSize != null) {
      const requested = Number(partialSize);
      if (!Number.isFinite(requested) || requested <= 0) {
        throw new Error('Taille de fermeture invalide');
      }
      const epsilon = Math.max(existing.size * 1e-6, 1e-9);
      if (requested >= existing.size - epsilon) {
        sizeToClose = existing.size;
      } else {
        sizeToClose = requested;
        isPartial = true;
      }
    }

    const exitPrice = existing.side === 'long' ? ticker.bidPrice : ticker.askPrice;
    existing.markPrice = exitPrice;
    existing.pnl = computePositionPnl(existing);

    if (existing.openedAt) {
      const heldMinutes = (Date.now() - existing.openedAt) / 60000;
      player.longestPositionMinutes = Math.max(player.longestPositionMinutes, heldMinutes);
    }

    const portion = sizeToClose / existing.size;
    const closeFee = exitPrice * sizeToClose * TAKER_FEE_RATE;
    const rawRealizedPnl = existing.side === 'long'
      ? (exitPrice - existing.entryPrice) * sizeToClose
      : (existing.entryPrice - exitPrice) * sizeToClose;
    // PnL réalisé converti en USD pour USD/JPY, USD/CHF (sinon identité).
    const realizedPnl = pnlToAccountCcy(pair, rawRealizedPnl, exitPrice);
    player.feesPaid += closeFee;
    existing.feesPaid += closeFee;

    const trade: Trade = {
      id: `${existing.id}-close-${Date.now()}`,
      playerName: player.name,
      playerColor: player.color,
      pair,
      side: existing.side,
      size: sizeToClose,
      price: exitPrice,
      fee: closeFee,
      leverage: existing.leverage,
      orderType: 'market',
      // Fees are already tracked in player.feesPaid and deducted in equity calc.
      // Keep trade.pnl as pure price PnL to avoid double fee deduction.
      pnl: realizedPnl,
      time: Date.now(),
      action: 'close',
    };

    const tradeReturn = (trade.pnl / (existing.entryPrice * sizeToClose)) * 100;
    player.bestTradePercent = Math.max(player.bestTradePercent, tradeReturn);
    if (trade.pnl > 0) {
      player.biggestTradePnl = Math.max(player.biggestTradePnl, trade.pnl);
    }
    if (!isPartial) {
      player.winStreak = trade.pnl > 0 ? player.winStreak + 1 : 0;
    }
    player.trades.push(trade);
    player.trades = player.trades.slice(-50);

    if (isPartial) {
      existing.size = existing.size - sizeToClose;
      existing.margin = existing.margin * (1 - portion);
      existing.feesPaid = existing.feesPaid * (1 - portion);
      existing.pnl = computePositionPnl(existing);
    } else {
      player.openPositions = player.openPositions.filter((position) => position !== existing);
    }

    this.updatePlayerEquity(player);

    return {
      trade,
      spotlight: {
        id: trade.id,
        playerName: player.name,
        playerColor: player.color,
        playerAvatar: player.avatar,
        pair,
        side: existing.side,
        size: sizeToClose,
        entryPrice: existing.entryPrice,
        action: 'close',
        pnl: trade.pnl,
        reason: 'manual',
      },
    };
  }

  cancelOrder(player: Player, orderId: string): void {
    const order = player.openOrders.find((entry) => entry.id === orderId && entry.status === 'open');
    if (!order) {
      throw new Error('Ordre introuvable');
    }
    player.openOrders = player.openOrders.filter((entry) => entry.id !== orderId);
    this.updatePlayerEquity(player);
  }

  updatePositionRisk(
    player: Player,
    positionRef: string,
    stopLoss: number | null,
    takeProfit: number | null,
    options: { stopLossSize?: number | null; takeProfitSize?: number | null } = {},
  ): void {
    const position = player.openPositions.find((entry) => entry.id === positionRef)
      ?? player.openPositions.find((entry) => entry.pair === positionRef);
    if (!position) {
      throw new Error('Position introuvable');
    }

    const pair = position.pair;
    assertMarketOpen(pair);
    const normalizedStopLoss = stopLoss == null ? null : Number(stopLoss);
    const normalizedTakeProfit = takeProfit == null ? null : Number(takeProfit);

    const ticker = this.market[pair];
    const reference = ticker?.markPrice && ticker.markPrice > 0 ? ticker.markPrice : position.entryPrice;
    validateRiskLevels(position.side, reference, normalizedStopLoss, normalizedTakeProfit);

    const normalizeSize = (raw: number | null | undefined): number | null => {
      if (raw == null) return null;
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) return null;
      const epsilon = Math.max(position.size * 1e-6, 1e-9);
      if (value >= position.size - epsilon) return null;
      return value;
    };

    const tpSize = normalizedTakeProfit == null ? null : normalizeSize(options.takeProfitSize ?? null);
    const slSize = normalizedStopLoss == null ? null : normalizeSize(options.stopLossSize ?? null);

    position.stopLoss = normalizedStopLoss;
    position.takeProfit = normalizedTakeProfit;
    position.stopLossSize = slSize;
    position.takeProfitSize = tpSize;
    this.updatePlayerEquity(player);
  }

  private resetPlayers(players: Player[]): void {
    for (const player of players) {
      player.initialBalance = this.startingBalance;
      player.currentBalance = this.startingBalance;
      player.availableMargin = this.startingBalance;
      player.usedMargin = 0;
      player.feesPaid = 0;
      player.pnl = 0;
      player.pnlPercent = 0;
      player.tradeCount = 0;
      player.trades = [];
      player.openPositions = [];
      player.openOrders = [];
      player.rank = 0;
      player.previousRank = 0;
      player.badges = [];
      player.winStreak = 0;
      player.longestPositionMinutes = 0;
      player.biggestTradePnl = 0;
      player.bestTradePercent = 0;
      player.lastUpdate = Date.now();
      player.connected = true;
    }
  }

  private async refreshTickers(players: Player[]): Promise<void> {
    const [krakenPrices, binancePrices, hyperliquidPrices] = await Promise.all([
      kraken.getTickerStats().catch(() => ({})),
      binance.getTickerStats().catch(() => ({})),
      hyperliquid.getAllMids().catch(() => ({})),
    ]);
    const now = Date.now();

    // Pour les pairs iTick, on récupère les derniers ticks live depuis
    // le registry iTick (déjà alimenté par le WS upstream). Si pas de
    // tick récent, fallback sur le mid Hyperliquid xyz si dispo.
    const activePairs = this.getActivePairDefs();
    this.market = Object.fromEntries(activePairs.map((item) => {
      // Pair iTick → lecture du last tick mémoire.
      if (item.source === 'itick') {
        const liveTick = itickFeed.getLatest(item.sourceSymbol);
        let markPrice = liveTick?.price ?? this.market[item.pair]?.markPrice ?? 0;
        let updatedAt = liveTick?.ts ?? now;
        if ((!markPrice || markPrice <= 0) && item.hyperliquidCoin) {
          const hlPrice = hyperliquidPrices[item.hyperliquidCoin];
          if (typeof hlPrice === 'number' && hlPrice > 0) {
            markPrice = hlPrice;
            updatedAt = now;
          }
        }
        const { bidPrice, askPrice } = markPrice > 0
          ? applyPaperMarkSpread(markPrice)
          : { bidPrice: 0, askPrice: 0 };
        // Alimenté par le poller REST iTick `/quotes` (toutes les 60s).
        // Pour les pairs où on n'a pas encore reçu de quote, on garde
        // la dernière valeur connue (pas de saut visuel à 0%).
        const itickQuote = itickFeed.getQuote(item.sourceSymbol);
        const change24h = itickQuote?.changePct ?? this.market[item.pair]?.change24h ?? null;
        return [item.pair, {
          pair: item.pair,
          symbol: item.sourceSymbol,
          markPrice,
          bidPrice,
          askPrice,
          change24h,
          spreadBps: markPrice > 0 ? ((askPrice - bidPrice) / markPrice) * 10000 : SPREAD_BPS,
          updatedAt,
        } satisfies MarketTicker];
      }

      // Pair crypto → iTick crypto (region BA = spot Binance = TradingView)
      // en priorité si un tick frais existe, sinon Kraken / Binance.
      const cryptoCode = cryptoPairToItickCode.get(item.pair);
      const itickCryptoTick = cryptoCode ? itickFeed.getLatest(cryptoCode, 'crypto') : undefined;
      if (itickCryptoTick && itickCryptoTick.price > 0 && now - itickCryptoTick.ts < ITICK_CRYPTO_STALE_MS) {
        const markPrice = itickCryptoTick.price;
        const { bidPrice, askPrice } = applyPaperMarkSpread(markPrice);
        return [item.pair, {
          pair: item.pair,
          symbol: item.sourceSymbol,
          markPrice,
          bidPrice,
          askPrice,
          change24h: this.market[item.pair]?.change24h ?? null,
          spreadBps: markPrice > 0 ? ((askPrice - bidPrice) / markPrice) * 10000 : SPREAD_BPS,
          updatedAt: itickCryptoTick.ts,
        } satisfies MarketTicker];
      }

      // Pair crypto → Kraken / Binance.
      const sourceKey = this.marketDataSource === 'binance'
        ? item.binanceSymbol || item.krakenSymbol || item.sourceSymbol
        : item.krakenSymbol || item.sourceSymbol;
      const sourcePrices = this.marketDataSource === 'binance' ? binancePrices : krakenPrices;
      const rawTicker = sourcePrices[sourceKey];
      let markPrice = (typeof rawTicker === 'number' ? rawTicker : rawTicker?.markPrice) || this.market[item.pair]?.markPrice || 0;
      // Fallback Hyperliquid si Binance/Kraken REST est rate-limité (418).
      if ((!markPrice || markPrice <= 0) && item.hyperliquidCoin) {
        const hlPrice = hyperliquidPrices[item.hyperliquidCoin];
        if (typeof hlPrice === 'number' && hlPrice > 0) {
          markPrice = hlPrice;
        }
      }
      const { bidPrice, askPrice } = applyPaperMarkSpread(markPrice);
      const change24h = typeof rawTicker === 'number' ? (this.market[item.pair]?.change24h ?? null) : (rawTicker?.change24h ?? null);
      return [item.pair, {
        pair: item.pair,
        symbol: sourceKey,
        markPrice,
        bidPrice,
        askPrice,
        change24h,
        spreadBps: markPrice > 0 ? ((askPrice - bidPrice) / markPrice) * 10000 : SPREAD_BPS,
        updatedAt: now,
      } satisfies MarketTicker];
    }));

    this.processOpenOrders(players);
    this.processRiskTriggers(players);

    for (const player of players) {
      this.updatePlayerEquity(player);
      player.connected = true;
      player.lastUpdate = Date.now();
    }

    this.onTick();
  }

  private startMarketFeed(): void {
    if (this.marketDataSource === 'kraken') {
      this.startTickerSocket();
      return;
    }
    if (this.marketDataSource === 'binance') {
      this.startBinanceTickerSocket();
      return;
    }
    if (this.websocket) {
      this.websocket.removeAllListeners();
      this.websocket.close();
      this.websocket = null;
    }
  }

  private startTickerSocket(): void {
    if (this.marketDataSource !== 'kraken') return;
    if (this.websocket) {
      this.websocket.removeAllListeners();
      this.websocket.close();
      this.websocket = null;
    }

    const ws = new WebSocket(KRAKEN_FUTURES_WS);
    this.websocket = ws;

    ws.on('open', () => {
      this.reconnectAttempts = 0;
      ws.send(JSON.stringify({
        event: 'subscribe',
        feed: 'ticker',
        product_ids: PAPER_PAIRS
          .filter((item): item is PaperPairDef & { krakenSymbol: string } => Boolean(item.krakenSymbol))
          .map((item) => item.krakenSymbol),
      }));
    });

    ws.on('message', (raw) => {
      try {
        const payload = JSON.parse(raw.toString());
        this.handleTickerMessage(payload);
      } catch (error) {
        console.error('Paper ticker WS parse failed:', (error as Error).message);
      }
    });

    ws.on('error', (error) => {
      console.error('Paper ticker WS error:', error.message);
    });

    ws.on('close', () => {
      if (this.websocket !== ws) return;
      this.websocket = null;
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.marketDataSource !== 'kraken' && this.marketDataSource !== 'binance') return;
    if (!this.marketFeedActive && this.playersRef.length === 0) return;
    if (this.reconnectTimeout) return;
    const delay = Math.min(15000, 1000 * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (this.marketDataSource === 'binance') this.startBinanceTickerSocket();
      else this.startTickerSocket();
    }, delay);
  }

  private startBinanceTickerSocket(): void {
    if (this.marketDataSource !== 'binance') return;
    if (this.websocket) {
      this.websocket.removeAllListeners();
      this.websocket.close();
      this.websocket = null;
    }

    const streams = this.getActivePairDefs()
      .filter((item): item is PaperPairDef & { binanceSymbol: string } => Boolean(item.binanceSymbol))
      .map((item) => `${item.binanceSymbol.toLowerCase()}@markPrice@1s`);

    if (streams.length === 0) return;

    const ws = new WebSocket(`${BINANCE_FUTURES_WS}${streams.join('/')}`);
    this.websocket = ws;

    ws.on('open', () => {
      this.reconnectAttempts = 0;
    });

    ws.on('message', (raw) => {
      try {
        const payload = JSON.parse(raw.toString());
        this.handleBinanceTickerMessage(payload?.data ?? payload);
      } catch (error) {
        console.error('Binance ticker WS parse failed:', (error as Error).message);
      }
    });

    ws.on('error', (error) => {
      console.error('Binance ticker WS error:', error.message);
    });

    ws.on('close', () => {
      if (this.websocket !== ws) return;
      this.websocket = null;
      this.scheduleReconnect();
    });
  }

  private handleBinanceTickerMessage(payload: any): void {
    const symbol = String(payload?.s || payload?.symbol || '').toUpperCase();
    const pair = symbolToBinancePair.get(symbol);
    if (!pair) return;

    const mark = asNumber(payload?.p)
      ?? asNumber(payload?.markPrice)
      ?? asNumber(payload?.c);
    if (!mark) return;

    this.applyTicker(pair, symbol, mark);
  }

  /**
   * Ouvre la WS Bybit linear et s'abonne à tous les `tickers.SYMBOL` des
   * pairs crypto supportées. Bybit pousse plusieurs ticks par seconde par
   * pair (≈ 10 Hz BTC), bien plus fluide que Binance markPrice@1s — et
   * surtout `stream.bybit.com` n'est pas geo-bloqué pour cet accès.
   *
   * Les ticks sont coalescés dans `bybitPendingPairs` et flushés toutes
   * les `BYBIT_FLUSH_INTERVAL_MS` pour limiter le débit broadcast WS.
   */
  private startBybitTickerSocket(): void {
    if (this.bybitWebsocket) {
      this.bybitWebsocket.removeAllListeners();
      this.bybitWebsocket.close();
      this.bybitWebsocket = null;
    }
    if (this.bybitPingInterval) {
      clearInterval(this.bybitPingInterval);
      this.bybitPingInterval = null;
    }

    const symbols = PAPER_PAIRS
      .filter((item): item is PaperPairDef & { binanceSymbol: string } => Boolean(item.binanceSymbol))
      .map((item) => item.binanceSymbol);

    if (symbols.length === 0) return;

    const ws = new WebSocket(BYBIT_LINEAR_WS);
    this.bybitWebsocket = ws;

    ws.on('open', () => {
      this.bybitReconnectAttempts = 0;
      // Bybit accepte jusqu'à 10 args par message subscribe sur le topic
      // tickers, on chunk pour tenir 60+ pairs.
      const chunkSize = 10;
      const args: string[] = symbols.map((s) => `tickers.${s}`);
      for (let i = 0; i < args.length; i += chunkSize) {
        const chunk = args.slice(i, i + chunkSize);
        ws.send(JSON.stringify({ op: 'subscribe', args: chunk }));
      }
      // Heartbeat 20 s (Bybit timeout = 30 s côté serveur).
      this.bybitPingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ op: 'ping' })); } catch { /* noop */ }
        }
      }, 20000);
      if (typeof this.bybitPingInterval.unref === 'function') {
        this.bybitPingInterval.unref();
      }
      // Démarre le flush coalescing si pas déjà actif.
      if (!this.bybitFlushTimer) {
        this.bybitFlushTimer = setInterval(() => this.flushBybitPending(), BYBIT_FLUSH_INTERVAL_MS);
        if (typeof this.bybitFlushTimer.unref === 'function') {
          this.bybitFlushTimer.unref();
        }
      }
      console.log(`[paper] Bybit linear WS up — ${symbols.length} pairs`);
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg && typeof msg === 'object' && typeof msg.topic === 'string' && msg.topic.startsWith('tickers.')) {
          this.handleBybitTickerMessage(msg);
        }
      } catch (error) {
        console.error('[paper] Bybit WS parse failed:', (error as Error).message);
      }
    });

    ws.on('error', (error) => {
      console.error('[paper] Bybit WS error:', error.message);
    });

    ws.on('close', () => {
      if (this.bybitWebsocket !== ws) return;
      this.bybitWebsocket = null;
      if (this.bybitPingInterval) {
        clearInterval(this.bybitPingInterval);
        this.bybitPingInterval = null;
      }
      this.scheduleBybitReconnect();
    });
  }

  private scheduleBybitReconnect(): void {
    if (!this.marketFeedActive) return;
    if (this.bybitReconnectTimeout) return;
    const delay = Math.min(15000, 1000 * 2 ** this.bybitReconnectAttempts);
    this.bybitReconnectAttempts += 1;
    this.bybitReconnectTimeout = setTimeout(() => {
      this.bybitReconnectTimeout = null;
      this.startBybitTickerSocket();
    }, delay);
    if (typeof this.bybitReconnectTimeout.unref === 'function') {
      this.bybitReconnectTimeout.unref();
    }
  }

  private handleBybitTickerMessage(msg: any): void {
    const data = msg?.data;
    if (!data || typeof data !== 'object') return;
    const symbol = String(data.symbol || '').toUpperCase();
    if (!symbol) return;
    const pair = bybitSymbolToPair.get(symbol);
    if (!pair) return;

    // Bybit pousse soit un snapshot complet, soit un delta partiel.
    // On essaye `lastPrice` puis `markPrice`, sinon mid bid/ask.
    const last = asNumber(data.lastPrice);
    const mark = asNumber(data.markPrice);
    const bid = asNumber(data.bid1Price);
    const ask = asNumber(data.ask1Price);
    const price = last ?? mark ?? (bid && ask ? (bid + ask) / 2 : null);
    if (!price || price <= 0) return;

    const { bidPrice, askPrice } = applyPaperMarkSpread(price);
    const change24h = asNumber(data.price24hPcnt) != null ? Number(data.price24hPcnt) * 100 : null;

    // Buffer uniquement — l'écriture effective dans `this.market` est
    // gérée par `flushBybitPending` qui contrôle si Binance est silencieux.
    this.bybitLatest.set(pair, { price, bid: bidPrice, askPrice, symbol, change24h, ts: Date.now() });
    this.bybitPendingPairs.add(pair);
  }

  private flushBybitPending(): void {
    if (this.bybitPendingPairs.size === 0) return;
    const candidates = Array.from(this.bybitPendingPairs);
    this.bybitPendingPairs.clear();

    const now = Date.now();
    const pairsTakenOver: string[] = [];

    for (const pair of candidates) {
      const buf = this.bybitLatest.get(pair);
      if (!buf) continue;

      // Failover : Bybit n'écrit que si Binance/Kraken n'a pas poussé de
      // tick pour cette pair depuis BYBIT_TAKEOVER_MS. Sinon on laisse
      // la source primaire dicter le rythme (1 Hz fluide, pas de
      // vibration de la bougie).
      const lastSourceTick = this.lastTickAt.get(pair) ?? 0;
      if (now - lastSourceTick < BYBIT_TAKEOVER_MS) continue;

      const prev = this.market[pair];
      this.market[pair] = {
        pair,
        symbol: prev?.symbol ?? buf.symbol,
        markPrice: buf.price,
        bidPrice: buf.bid,
        askPrice: buf.askPrice,
        change24h: buf.change24h ?? prev?.change24h ?? null,
        spreadBps: buf.price > 0 ? ((buf.askPrice - buf.bid) / buf.price) * 10000 : SPREAD_BPS,
        updatedAt: now,
      };
      this.lastTickAt.set(pair, now);
      engineCandlesCache.updateLastCandleFromTick(pair, buf.price, now);
      pairsTakenOver.push(pair);
    }

    if (pairsTakenOver.length === 0) return;

    if (this.playersRef.length > 0) {
      this.processOpenOrders(this.playersRef);
      this.processRiskTriggers(this.playersRef);
      for (const player of this.playersRef) {
        this.updatePlayerEquity(player);
        player.connected = true;
        player.lastUpdate = now;
      }
    }

    this.onMarketPairsUpdated?.(pairsTakenOver);
    this.onTick();
  }

  private handleTickerMessage(payload: any): void {
    if (!payload || payload.event || payload.feed !== 'ticker') return;

    const symbol = String(payload.product_id || payload.productId || payload.symbol || '').toUpperCase();
    const pair = symbolToPair.get(symbol);
    if (!pair) return;

    // iTick crypto est la source primaire : Kraken n'est qu'un failover et
    // ne touche au prix que si iTick n'a rien poussé depuis le seuil.
    const lastItick = this.lastItickCryptoAt.get(pair) ?? 0;
    if (Date.now() - lastItick < ITICK_CRYPTO_TAKEOVER_MS) return;

    const bid = asNumber(payload.bid) ?? asNumber(payload.bestBid);
    const ask = asNumber(payload.ask) ?? asNumber(payload.bestAsk);
    const mark = asNumber(payload.markPrice)
      ?? asNumber(payload.mark_price)
      ?? asNumber(payload.mark)
      ?? asNumber(payload.last)
      ?? (bid && ask ? (bid + ask) / 2 : null);

    if (!mark) return;

    this.applyTicker(pair, symbol, mark, bid ?? undefined, ask ?? undefined);
  }

  private applyTicker(pair: string, symbol: string, markPrice: number, _bid?: number, _ask?: number): void {
    const now = Date.now();
    const { bidPrice, askPrice } = applyPaperMarkSpread(markPrice);

    this.market[pair] = {
      pair,
      symbol,
      markPrice,
      bidPrice,
      askPrice,
      change24h: this.market[pair]?.change24h ?? null,
      spreadBps: markPrice > 0 ? ((askPrice - bidPrice) / markPrice) * 10000 : SPREAD_BPS,
      updatedAt: now,
    };

    // Marque ce pair comme servi par la source primaire (Binance/Kraken).
    // Bybit ne prendra le relais que si on n'updatait plus depuis 3 s.
    this.lastTickAt.set(pair, now);

    // Tenir la bougie courante du cache à jour pour que la prochaine
    // requête historique reflète immédiatement le dernier tick.
    engineCandlesCache.updateLastCandleFromTick(pair, markPrice, now);

    this.processOpenOrders(this.playersRef);
    this.processRiskTriggers(this.playersRef);

    for (const player of this.playersRef) {
      this.updatePlayerEquity(player);
      player.connected = true;
      player.lastUpdate = now;
    }

    this.onMarketPairsUpdated?.([pair]);
    this.onTick();
  }

  private processOpenOrders(players: Player[]): void {
    // Warmup : pendant les 10 premières secondes après boot on ne match
    // aucun ordre limite. Évite les exécutions parasites sur les premiers
    // ticks iTick reçus juste après la reconnexion WS (parfois stale ou
    // décorrélés du marché réel pendant 1-2 ticks).
    if (Date.now() - this.bootedAt < LIMIT_WARMUP_MS) return;

    for (const player of players) {
      const executable = player.openOrders.filter((order) => {
        if (order.status !== 'open' || order.limitPrice == null) return false;
        if (!getMarketSessionForPair(order.pair).open) return false;
        const ticker = this.market[order.pair];
        if (!ticker) return false;
        return order.side === 'long'
          ? ticker.askPrice <= order.limitPrice
          : ticker.bidPrice >= order.limitPrice;
      });

      for (const order of executable) {
        const ticker = this.market[order.pair];
        // Price improvement : un ordre limite croisable se remplit au
        // meilleur des deux prix pour le trader (jamais pire que le marché),
        // exactement comme un vrai carnet d'ordres. On évite ainsi qu'un
        // ordre limite posté à un prix déjà franchi exécute à un prix
        // arbitraire (meilleur OU pire) côté client.
        const marketPrice = order.side === 'long' ? ticker.askPrice : ticker.bidPrice;
        const fillPrice = order.side === 'long'
          ? Math.min(order.limitPrice || marketPrice, marketPrice)
          : Math.max(order.limitPrice || marketPrice, marketPrice);
        console.log(
          `[paper] limit fill ${player.name} ${order.pair} ${order.side} `
          + `limit=${order.limitPrice} fill=${fillPrice} mark=${ticker?.markPrice} `
          + `size=${order.size} orderId=${order.id} placedAt=${order.createdAt ?? '?'}`,
        );
        player.openOrders = player.openOrders.filter((entry) => entry.id !== order.id);
        this.executeOrder(player, order, fillPrice, MAKER_FEE_RATE);
      }
    }
  }

  private processRiskTriggers(players: Player[]): void {
    for (const player of players) {
      const positions = [...player.openPositions];
      for (const position of positions) {
        if (!player.openPositions.includes(position)) continue;
        const ticker = this.market[position.pair];
        if (!ticker) continue;
        // Cohérence avec le blocage manuel : aucun déclenchement automatique
        // (liquidation / SL / TP) tant que le marché de la pair est fermé.
        if (!getMarketSessionForPair(position.pair).open) continue;

        // Liquidation serveur : si le mark franchit le prix de liquidation,
        // la position est fermée de force avant toute autre logique. Sans ça
        // un trader sur-levier pouvait "survivre" à une mèche qui aurait dû
        // le liquider sur un vrai exchange (avantage déloyal) et faire passer
        // son équité en négatif.
        if (position.liquidationPrice != null && position.liquidationPrice > 0) {
          const liquidated = position.side === 'long'
            ? ticker.markPrice <= position.liquidationPrice
            : ticker.markPrice >= position.liquidationPrice;
          if (liquidated) {
            this.closePositionAtPrice(player, position, position.liquidationPrice, undefined, 'liquidation');
            continue;
          }
        }

        let trigger: 'sl' | 'tp' | null = null;
        if (position.side === 'long') {
          if (position.stopLoss != null && ticker.bidPrice <= position.stopLoss) trigger = 'sl';
          else if (position.takeProfit != null && ticker.bidPrice >= position.takeProfit) trigger = 'tp';
        } else {
          if (position.stopLoss != null && ticker.askPrice >= position.stopLoss) trigger = 'sl';
          else if (position.takeProfit != null && ticker.askPrice <= position.takeProfit) trigger = 'tp';
        }

        if (!trigger) continue;

        const exitPrice = position.side === 'long' ? ticker.bidPrice : ticker.askPrice;
        const partialSize = trigger === 'tp' ? (position.takeProfitSize ?? null) : (position.stopLossSize ?? null);

        const reason: 'stop-loss' | 'take-profit' = trigger === 'tp' ? 'take-profit' : 'stop-loss';
        if (partialSize != null && partialSize > 0 && partialSize < position.size) {
          this.closePositionAtPrice(player, position, exitPrice, partialSize, reason);
          if (player.openPositions.includes(position)) {
            if (trigger === 'tp') {
              position.takeProfit = null;
              position.takeProfitSize = null;
            } else {
              position.stopLoss = null;
              position.stopLossSize = null;
            }
          }
        } else {
          this.closePositionAtPrice(player, position, exitPrice, undefined, reason);
        }
      }
    }
  }

  private closePositionAtPrice(
    player: Player,
    existing: Position,
    exitPrice: number,
    partialSize?: number,
    reason: 'manual' | 'stop-loss' | 'take-profit' | 'liquidation' = 'manual',
  ): void {
    let sizeToClose = existing.size;
    let isPartial = false;
    if (partialSize != null) {
      const requested = Number(partialSize);
      const epsilon = Math.max(existing.size * 1e-6, 1e-9);
      if (Number.isFinite(requested) && requested > 0 && requested < existing.size - epsilon) {
        sizeToClose = requested;
        isPartial = true;
      }
    }

    existing.markPrice = exitPrice;
    existing.pnl = computePositionPnl(existing);

    if (existing.openedAt) {
      const heldMinutes = (Date.now() - existing.openedAt) / 60000;
      player.longestPositionMinutes = Math.max(player.longestPositionMinutes, heldMinutes);
    }

    const portion = sizeToClose / existing.size;
    const closeFee = exitPrice * sizeToClose * TAKER_FEE_RATE;
    const rawRealizedPnl = existing.side === 'long'
      ? (exitPrice - existing.entryPrice) * sizeToClose
      : (existing.entryPrice - exitPrice) * sizeToClose;
    const realizedPnl = pnlToAccountCcy(existing.pair, rawRealizedPnl, exitPrice);
    player.feesPaid += closeFee;
    existing.feesPaid += closeFee;

    const trade: Trade = {
      id: `${player.id}-${existing.pair}-risk-${Date.now()}`,
      playerName: player.name,
      playerColor: player.color,
      pair: existing.pair,
      side: existing.side,
      size: sizeToClose,
      price: exitPrice,
      fee: closeFee,
      leverage: existing.leverage,
      orderType: 'market',
      // Fees are already tracked in player.feesPaid and deducted in equity calc.
      // Keep trade.pnl as pure price PnL to avoid double fee deduction.
      pnl: realizedPnl,
      time: Date.now(),
      action: 'close',
    };

    const tradeReturn = (trade.pnl / (existing.entryPrice * sizeToClose)) * 100;
    player.bestTradePercent = Math.max(player.bestTradePercent, tradeReturn);
    if (trade.pnl > 0) {
      player.biggestTradePnl = Math.max(player.biggestTradePnl, trade.pnl);
    }
    if (!isPartial) {
      player.winStreak = trade.pnl > 0 ? player.winStreak + 1 : 0;
    }
    player.trades.push(trade);
    player.trades = player.trades.slice(-50);

    if (isPartial) {
      existing.size = existing.size - sizeToClose;
      existing.margin = existing.margin * (1 - portion);
      existing.feesPaid = existing.feesPaid * (1 - portion);
      existing.pnl = computePositionPnl(existing);
    } else {
      player.openPositions = player.openPositions.filter((position) => position !== existing);
    }

    this.updatePlayerEquity(player);

    // Spotlight automatique uniquement pour les déclenchements SL/TP. Les
    // fermetures manuelles passent par closePosition() qui retourne déjà
    // un spotlight au PlayerManager.
    if (reason !== 'manual') {
      this.engineSpotlights.push({
        id: trade.id,
        playerName: player.name,
        playerColor: player.color,
        playerAvatar: player.avatar,
        pair: existing.pair,
        side: existing.side,
        size: sizeToClose,
        entryPrice: existing.entryPrice,
        action: 'close',
        pnl: trade.pnl,
        reason,
      });
    }
  }

  private executeOrder(player: Player, order: Order, executionPrice: number, feeRate: number): PaperOrderResult {
    console.log(
      `[paper] executeOrder ${player.name} ${order.pair} ${order.side} `
      + `${order.orderType} size=${order.size} @ ${executionPrice} `
      + `(orderId=${order.id} createdAt=${order.createdAt})`,
    );
    const notional = executionPrice * order.size;
    const margin = notional / order.leverage;
    const fee = notional * feeRate;
    const availableWithReserve = player.availableMargin + order.marginReserved + order.feeEstimate;

    if (margin + fee > availableWithReserve) {
      throw new Error(`Capital disponible insuffisant (${player.availableMargin.toFixed(2)}$)`);
    }

    const orderStopLoss = order.stopLoss ?? null;
    const orderTakeProfit = order.takeProfit ?? null;
    validateRiskLevels(order.side, executionPrice, orderStopLoss, orderTakeProfit);

    const openedAt = Date.now();
    const position: Position = {
      id: order.id,
      pair: order.pair,
      side: order.side,
      size: order.size,
      entryPrice: executionPrice,
      markPrice: executionPrice,
      pnl: 0,
      unrealizedFunding: 0,
      leverage: order.leverage,
      margin,
      feesPaid: fee,
      liquidationPrice: this.computeLiquidationPrice(executionPrice, order.side, order.leverage),
      stopLoss: orderStopLoss,
      takeProfit: orderTakeProfit,
      openedAt,
    };

    player.feesPaid += fee;
    player.openPositions.push(position);
    player.tradeCount += 1;

    const trade: Trade = {
      id: order.id,
      playerName: player.name,
      playerColor: player.color,
      pair: order.pair,
      side: order.side,
      size: order.size,
      price: executionPrice,
      fee,
      leverage: order.leverage,
      orderType: order.orderType,
      pnl: 0,
      time: openedAt,
      action: 'open',
    };
    player.trades.push(trade);
    player.trades = player.trades.slice(-50);
    this.updatePlayerEquity(player);

    return {
      trade,
      spotlight: {
        id: trade.id,
        playerName: player.name,
        playerColor: player.color,
        playerAvatar: player.avatar,
        pair: order.pair,
        side: order.side,
        size: order.size,
        entryPrice: executionPrice,
        action: 'open',
        pnl: 0,
      },
    };
  }

  private computeLiquidationPrice(entryPrice: number, side: 'long' | 'short', leverage: number): number {
    const maintenance = 1 / leverage;
    return side === 'long'
      ? entryPrice * (1 - maintenance)
      : entryPrice * (1 + maintenance);
  }

  private updatePlayerEquity(player: Player): void {
    const now = Date.now();
    player.openPositions = player.openPositions.map((position) => {
      const id = position.id || `${player.id}-${position.pair}-${position.openedAt || now}-${Math.random().toString(36).slice(2, 8)}`;
      const markPrice = this.market[position.pair]?.markPrice || position.markPrice;
      const updated = { ...position, id, markPrice };
      updated.pnl = computePositionPnl(updated);
      if (updated.openedAt) {
        const heldMinutes = (now - updated.openedAt) / 60000;
        player.longestPositionMinutes = Math.max(player.longestPositionMinutes, heldMinutes);
      }
      return updated;
    });

    const realizedPnl = getRealizedPnl(player);
    const unrealizedPnl = player.openPositions.reduce((total, position) => total + position.pnl, 0);
    const initialBalance = player.initialBalance ?? this.startingBalance;
    player.usedMargin = player.openPositions.reduce((total, position) => total + position.margin, 0);
    const reservedCapital = getReservedCapital(player);

    player.currentBalance = initialBalance + realizedPnl + unrealizedPnl - player.feesPaid;
    player.availableMargin = Math.max(0, player.currentBalance - player.usedMargin - reservedCapital);
    player.pnl = player.currentBalance - initialBalance;
    player.pnlPercent = initialBalance > 0 ? (player.pnl / initialBalance) * 100 : 0;
  }
}

export function getPaperPairDefinition(pair: string): PaperPairDef | undefined {
  return pairToDefinition.get(pair);
}
