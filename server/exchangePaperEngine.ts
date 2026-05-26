import crypto from 'crypto';
import WebSocket from 'ws';
import type { MarketDataSource, MarketTicker, Order, OrderType, Player, Position, SpotlightTrade, Trade } from './types.js';
import * as kraken from './kraken.js';
import * as oanda from './oanda.js';
import * as binance from './binance.js';
import * as hyperliquid from './hyperliquid.js';
import * as mt5Feed from './mt5Feed.js';
import { OANDA_TRADFI_PAIRS } from './oandaInstruments.js';

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

type PaperPairSource = 'kraken_futures' | 'oanda';
type PaperPairDef = {
  pair: string;
  source: PaperPairSource;
  sourceSymbol: string;
  krakenSymbol?: string;
  hyperliquidCoin?: string;
  binanceSymbol?: string;
  oandaInvert?: boolean;
};

const cryptoPair = (pair: string, krakenSymbol: string, hyperliquidCoin: string, binanceSymbol?: string): PaperPairDef => ({
  pair,
  source: 'kraken_futures',
  sourceSymbol: krakenSymbol,
  krakenSymbol,
  hyperliquidCoin,
  binanceSymbol: binanceSymbol || binance.pairToBinanceSymbol(pair) || undefined,
});

const oandaPair = (pair: string, instrument: string, hyperliquidSymbol: string, invert = false): PaperPairDef => ({
  pair,
  source: 'oanda',
  sourceSymbol: instrument,
  hyperliquidCoin: hyperliquidSymbol,
  oandaInvert: invert,
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
  ...OANDA_TRADFI_PAIRS.map(({ pair, instrument, hyperliquidSymbol, invert }) => oandaPair(pair, instrument, hyperliquidSymbol, Boolean(invert))),
];

const SPREAD_BPS = 0;
const TAKER_FEE_RATE = 0.00005;
const MAKER_FEE_RATE = 0.00002;
const MAX_LEVERAGE = 50;
const MIN_LEVERAGE = 1;
const KRAKEN_FUTURES_WS = 'wss://futures.kraken.com/ws/v1';
const BINANCE_FUTURES_WS = 'wss://fstream.binance.com/stream?streams=';

const pairToDefinition = new Map(PAPER_PAIRS.map((item) => [item.pair, item]));
const pairToKrakenSymbol = new Map(PAPER_PAIRS.filter((item) => item.krakenSymbol).map((item) => [item.pair, item.krakenSymbol as string]));
const symbolToPair = new Map(PAPER_PAIRS.filter((item) => item.krakenSymbol).map((item) => [item.krakenSymbol as string, item.pair]));
const symbolToBinancePair = new Map(PAPER_PAIRS.filter((item) => item.binanceSymbol).map((item) => [item.binanceSymbol as string, item.pair]));

function computePositionPnl(position: Position): number {
  return position.side === 'long'
    ? (position.markPrice - position.entryPrice) * position.size
    : (position.entryPrice - position.markPrice) * position.size;
}

/** Bid/ask compétition : exécution au mark (futures), pas le spread CFD MT5/OANDA. */
function applyPaperMarkSpread(markPrice: number): { bidPrice: number; askPrice: number } {
  return { bidPrice: markPrice, askPrice: markPrice };
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

export class PaperTradingEngine {
  private market: Record<string, MarketTicker> = {};
  private tickerInterval: ReturnType<typeof setInterval> | null = null;
  private websocket: WebSocket | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private playersRef: Player[] = [];
  private startingBalance = 10_000;
  private marketDataSource: MarketDataSource = 'kraken';
  private onTick: () => void;

  constructor(onTick: () => void) {
    this.onTick = onTick;
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
    return this.market;
  }

  async refreshMarketSnapshot(): Promise<Record<string, MarketTicker>> {
    await this.refreshTickers(this.playersRef);
    return this.market;
  }

  private getActivePairDefs(): PaperPairDef[] {
    if (this.marketDataSource === 'binance') {
      return PAPER_PAIRS.filter((item) => Boolean(item.binanceSymbol) || item.source === 'oanda');
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
    if (!changed || this.playersRef.length === 0) return;

    this.startMarketFeed();
    this.refreshTickers(this.playersRef).catch((error) => {
      console.error('Paper source switch refresh failed:', (error as Error).message);
    });
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
    this.stop();
    this.playersRef = players;
    if (options.reset !== false) {
      this.resetPlayers(players);
    }
    await this.refreshTickers(players);
    this.startMarketFeed();

    // Low-frequency fallback keeps the market alive if the public WS drops.
    const fallbackMs = this.marketDataSource === 'binance' ? 5000 : 30000;
    this.tickerInterval = setInterval(() => {
      this.refreshTickers(players).catch((error) => {
        console.error('Paper fallback ticker refresh failed:', (error as Error).message);
      });
    }, fallbackMs);
  }

  stop(): void {
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
    this.playersRef = [];
    this.reconnectAttempts = 0;
  }

  async placeOrder(player: Player, input: PaperOrderInput): Promise<PaperOrderResult> {
    const pair = input.pair;
    const side = input.side;
    const size = Number(input.size);
    const orderType = input.orderType;
    const leverage = clampLeverage(Number(input.leverage));
    const pairDefinition = pairToDefinition.get(pair);

    if (!pairDefinition) throw new Error('Pair non supportée');
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
    const existing = player.openPositions.find((position) => position.id === positionRef)
      ?? player.openPositions.find((position) => position.pair === positionRef);
    if (!existing) {
      throw new Error('Position introuvable');
    }

    const pair = existing.pair;
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
    const realizedPnl = existing.side === 'long'
      ? (exitPrice - existing.entryPrice) * sizeToClose
      : (existing.entryPrice - exitPrice) * sizeToClose;
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
      player.biggestTradeVolume = 0;
      player.bestTradePercent = 0;
      player.lastUpdate = Date.now();
      player.connected = true;
    }
  }

  private async refreshTickers(players: Player[]): Promise<void> {
    const [krakenPrices, oandaPrices, binancePrices, hyperliquidPrices, mt5Prices] = await Promise.all([
      kraken.getTickerStats().catch(() => ({})),
      oanda.getPricing().catch(() => ({})),
      binance.getTickerStats().catch(() => ({})),
      hyperliquid.getAllMids().catch(() => ({})),
      Promise.resolve(mt5Feed.getPricing()),
    ]);
    const now = Date.now();

    const activePairs = this.getActivePairDefs();
    this.market = Object.fromEntries(activePairs.map((item) => {
      const sourceKey = item.source === 'oanda'
        ? item.sourceSymbol
        : this.marketDataSource === 'binance'
          ? item.binanceSymbol || item.krakenSymbol || item.sourceSymbol
          : item.krakenSymbol || item.sourceSymbol;
      const sourcePrices = item.source === 'oanda'
        ? oandaPrices
        : this.marketDataSource === 'binance'
          ? binancePrices
          : krakenPrices;
      const rawTicker = sourcePrices[sourceKey];
      let markPrice = (typeof rawTicker === 'number' ? rawTicker : rawTicker?.markPrice) || this.market[item.pair]?.markPrice || 0;
      let bidPrice = typeof rawTicker === 'number'
        ? Math.max(0, markPrice * (1 - SPREAD_BPS / 10000))
        : (rawTicker?.bidPrice ?? Math.max(0, markPrice - markPrice * (SPREAD_BPS / 10000)));
      let askPrice = typeof rawTicker === 'number'
        ? markPrice * (1 + SPREAD_BPS / 10000)
        : (rawTicker?.askPrice ?? markPrice + markPrice * (SPREAD_BPS / 10000));
      let updatedAt = now;

      if (item.source === 'oanda') {
        const mt5Quote = mt5Prices[item.pair];
        if (mt5Quote) {
          markPrice = mt5Quote.markPrice;
          updatedAt = mt5Quote.updatedAt;
        } else if (rawTicker && typeof rawTicker !== 'number') {
          markPrice = rawTicker.markPrice || markPrice;
          if (markPrice <= 0 && rawTicker.bidPrice && rawTicker.askPrice) {
            markPrice = (rawTicker.bidPrice + rawTicker.askPrice) / 2;
          }
        } else if (markPrice <= 0 && item.hyperliquidCoin) {
          const hlPrice = hyperliquidPrices[item.hyperliquidCoin];
          if (typeof hlPrice === 'number' && hlPrice > 0) {
            markPrice = hlPrice;
          }
        }
        if (markPrice > 0) {
          ({ bidPrice, askPrice } = applyPaperMarkSpread(markPrice));
        }
      }

      const change24h = typeof rawTicker === 'number' ? (this.market[item.pair]?.change24h ?? null) : (rawTicker?.change24h ?? null);
      return [item.pair, {
        pair: item.pair,
        symbol: sourceKey,
        markPrice,
        bidPrice,
        askPrice,
        change24h,
        spreadBps: markPrice > 0 ? ((askPrice - bidPrice) / markPrice) * 10000 : SPREAD_BPS,
        updatedAt,
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
    if (this.playersRef.length === 0 || this.reconnectTimeout) return;
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

  private handleTickerMessage(payload: any): void {
    if (!payload || payload.event || payload.feed !== 'ticker') return;

    const symbol = String(payload.product_id || payload.productId || payload.symbol || '').toUpperCase();
    const pair = symbolToPair.get(symbol);
    if (!pair) return;

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

  private applyTicker(pair: string, symbol: string, markPrice: number, bid?: number, ask?: number): void {
    const now = Date.now();
    const halfSpread = markPrice * (SPREAD_BPS / 10000);
    const bidPrice = bid ?? Math.max(0, markPrice - halfSpread);
    const askPrice = ask ?? markPrice + halfSpread;

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

    this.processOpenOrders(this.playersRef);
    this.processRiskTriggers(this.playersRef);

    for (const player of this.playersRef) {
      this.updatePlayerEquity(player);
      player.connected = true;
      player.lastUpdate = now;
    }

    this.onTick();
  }

  private processOpenOrders(players: Player[]): void {
    for (const player of players) {
      const executable = player.openOrders.filter((order) => {
        if (order.status !== 'open' || order.limitPrice == null) return false;
        const ticker = this.market[order.pair];
        if (!ticker) return false;
        return order.side === 'long'
          ? ticker.askPrice <= order.limitPrice
          : ticker.bidPrice >= order.limitPrice;
      });

      for (const order of executable) {
        player.openOrders = player.openOrders.filter((entry) => entry.id !== order.id);
        this.executeOrder(player, order, order.limitPrice || 0, MAKER_FEE_RATE);
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

        if (partialSize != null && partialSize > 0 && partialSize < position.size) {
          this.closePositionAtPrice(player, position, exitPrice, partialSize);
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
          this.closePositionAtPrice(player, position, exitPrice);
        }
      }
    }
  }

  private closePositionAtPrice(player: Player, existing: Position, exitPrice: number, partialSize?: number): void {
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
    const realizedPnl = existing.side === 'long'
      ? (exitPrice - existing.entryPrice) * sizeToClose
      : (existing.entryPrice - exitPrice) * sizeToClose;
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
  }

  private executeOrder(player: Player, order: Order, executionPrice: number, feeRate: number): PaperOrderResult {
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
    player.biggestTradeVolume = Math.max(player.biggestTradeVolume, notional);

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
    player.openPositions = player.openPositions.map((position) => {
      const id = position.id || `${player.id}-${position.pair}-${position.openedAt || Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const markPrice = this.market[position.pair]?.markPrice || position.markPrice;
      const updated = { ...position, id, markPrice };
      updated.pnl = computePositionPnl(updated);
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
