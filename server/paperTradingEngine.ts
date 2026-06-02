import crypto from 'crypto';
import type { Player, Position, SpotlightTrade, Trade } from './types.js';
import * as kraken from './kraken.js';

export interface PaperOrderInput {
  pair: string;
  side: 'long' | 'short';
  size: number;
}

export interface PaperOrderResult {
  trade: Trade;
  spotlight: SpotlightTrade;
}

export const PAPER_PAIRS = [
  { pair: 'BTC/USD', symbol: 'PF_XBTUSD' },
  { pair: 'ETH/USD', symbol: 'PF_ETHUSD' },
  { pair: 'XRP/USD', symbol: 'PF_XRPUSD' },
  { pair: 'BNB/USD', symbol: 'PF_BNBUSD' },
  { pair: 'SOL/USD', symbol: 'PF_SOLUSD' },
  { pair: 'DOGE/USD', symbol: 'PF_DOGEUSD' },
  { pair: 'ADA/USD', symbol: 'PF_ADAUSD' },
  { pair: 'TRX/USD', symbol: 'PF_TRXUSD' },
  { pair: 'LINK/USD', symbol: 'PF_LINKUSD' },
  { pair: 'AVAX/USD', symbol: 'PF_AVAXUSD' },
  { pair: 'XLM/USD', symbol: 'PF_XLMUSD' },
  { pair: 'BCH/USD', symbol: 'PF_BCHUSD' },
  { pair: 'DOT/USD', symbol: 'PF_DOTUSD' },
  { pair: 'LTC/USD', symbol: 'PF_LTCUSD' },
  { pair: 'SUI/USD', symbol: 'PF_SUIUSD' },
  { pair: 'HBAR/USD', symbol: 'PF_HBARUSD' },
  { pair: 'TON/USD', symbol: 'PF_TONUSD' },
  { pair: 'SHIB/USD', symbol: 'PF_SHIBUSD' },
  { pair: 'UNI/USD', symbol: 'PF_UNIUSD' },
  { pair: 'AAVE/USD', symbol: 'PF_AAVEUSD' },
  { pair: 'NEAR/USD', symbol: 'PF_NEARUSD' },
  { pair: 'APT/USD', symbol: 'PF_APTUSD' },
  { pair: 'ICP/USD', symbol: 'PF_ICPUSD' },
  { pair: 'ETC/USD', symbol: 'PF_ETCUSD' },
  { pair: 'POL/USD', symbol: 'PF_POLUSD' },
  { pair: 'FET/USD', symbol: 'PF_FETUSD' },
  { pair: 'RENDER/USD', symbol: 'PF_RENDERUSD' },
  { pair: 'ONDO/USD', symbol: 'PF_ONDOUSD' },
  { pair: 'FIL/USD', symbol: 'PF_FILUSD' },
  { pair: 'ARB/USD', symbol: 'PF_ARBUSD' },
  { pair: 'ATOM/USD', symbol: 'PF_ATOMUSD' },
  { pair: 'OP/USD', symbol: 'PF_OPUSD' },
  { pair: 'INJ/USD', symbol: 'PF_INJUSD' },
  { pair: 'WLD/USD', symbol: 'PF_WLDUSD' },
  { pair: 'SEI/USD', symbol: 'PF_SEIUSD' },
  { pair: 'IMX/USD', symbol: 'PF_IMXUSD' },
  { pair: 'GRT/USD', symbol: 'PF_GRTUSD' },
  { pair: 'ALGO/USD', symbol: 'PF_ALGOUSD' },
  { pair: 'SAND/USD', symbol: 'PF_SANDUSD' },
  { pair: 'MANA/USD', symbol: 'PF_MANAUSD' },
  { pair: 'QNT/USD', symbol: 'PF_QNTUSD' },
  { pair: 'STX/USD', symbol: 'PF_STXUSD' },
  { pair: 'LDO/USD', symbol: 'PF_LDOUSD' },
  { pair: 'RUNE/USD', symbol: 'PF_RUNEUSD' },
  { pair: 'APE/USD', symbol: 'PF_APEUSD' },
  { pair: 'PENDLE/USD', symbol: 'PF_PENDLEUSD' },
  { pair: 'TIA/USD', symbol: 'PF_TIAUSD' },
  { pair: 'JUP/USD', symbol: 'PF_JUPUSD' },
  { pair: 'PYTH/USD', symbol: 'PF_PYTHUSD' },
  { pair: 'BONK/USD', symbol: 'PF_BONKUSD' },
] as const;

const pairToSymbol: Map<string, string> = new Map(PAPER_PAIRS.map((item) => [item.pair, item.symbol]));

function computePositionPnl(position: Position): number {
  return position.side === 'long'
    ? (position.markPrice - position.entryPrice) * position.size
    : (position.entryPrice - position.markPrice) * position.size;
}

function getRealizedPnl(player: Player): number {
  return player.trades
    .filter((trade) => trade.action === 'close')
    .reduce((total, trade) => total + trade.pnl, 0);
}

function getExposure(player: Player): number {
  return player.openPositions.reduce((total, position) => total + position.size * position.markPrice, 0);
}

export class PaperTradingEngine {
  private tickerPrices: Record<string, number> = {};
  private tickerInterval: ReturnType<typeof setInterval> | null = null;
  private startingBalance = 10_000;
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
    return PAPER_PAIRS.map((item) => item.pair);
  }

  async start(players: Player[]): Promise<void> {
    this.stop();
    this.resetPlayers(players);
    await this.refreshTickers(players);
    this.tickerInterval = setInterval(() => {
      this.refreshTickers(players).catch((error) => {
        console.error('Paper ticker refresh failed:', (error as Error).message);
      });
    }, 5000);
  }

  stop(): void {
    if (this.tickerInterval) {
      clearInterval(this.tickerInterval);
      this.tickerInterval = null;
    }
  }

  async placeOrder(player: Player, input: PaperOrderInput): Promise<PaperOrderResult> {
    const pair = input.pair;
    const side = input.side;
    const size = Number(input.size);
    const symbol = pairToSymbol.get(pair);

    if (!symbol) {
      throw new Error('Pair non supportée');
    }
    if (!Number.isFinite(size) || size <= 0) {
      throw new Error('Taille de position invalide');
    }
    if (!this.tickerPrices[symbol]) {
      await this.refreshTickers([player]);
    }
    const entryPrice = this.tickerPrices[symbol];
    if (!entryPrice) {
      throw new Error('Prix de marché indisponible');
    }

    const notional = entryPrice * size;
    const available = Math.max(0, player.currentBalance - getExposure(player));
    if (notional > available) {
      throw new Error(`Capital disponible insuffisant (${available.toFixed(2)}$)`);
    }

    const openedAt = Date.now();
    const positionId = crypto.randomUUID();
    const position: Position = {
      id: positionId,
      pair,
      side,
      size,
      entryPrice,
      markPrice: entryPrice,
      pnl: 0,
      unrealizedFunding: 0,
      leverage: 1,
      margin: notional,
      feesPaid: 0,
      liquidationPrice: null,
      stopLoss: null,
      takeProfit: null,
      openedAt,
    };
    player.openPositions.push(position);
    player.tradeCount += 1;
    this.updatePlayerEquity(player);

    const trade: Trade = {
      id: positionId,
      playerName: player.name,
      playerColor: player.color,
      pair,
      side,
      size,
      price: entryPrice,
      fee: 0,
      leverage: 1,
      orderType: 'market',
      pnl: 0,
      time: openedAt,
      action: 'open',
    };
    player.trades.push(trade);
    player.trades = player.trades.slice(-50);

    return {
      trade,
      spotlight: {
        id: trade.id,
        playerName: player.name,
        playerColor: player.color,
        playerAvatar: player.avatar,
        pair,
        side,
        size,
        entryPrice,
        action: 'open',
        pnl: 0,
      },
    };
  }

  async closePosition(player: Player, pair: string): Promise<PaperOrderResult> {
    const existing = player.openPositions.find((position) => position.pair === pair);
    if (!existing) {
      throw new Error('Aucune position ouverte sur cette paire');
    }

    const symbol = pairToSymbol.get(pair);
    if (symbol && !this.tickerPrices[symbol]) {
      await this.refreshTickers([player]);
    }
    if (symbol && this.tickerPrices[symbol]) {
      existing.markPrice = this.tickerPrices[symbol];
    }
    existing.pnl = computePositionPnl(existing);

    if (existing.openedAt) {
      const heldMinutes = (Date.now() - existing.openedAt) / 60000;
      player.longestPositionMinutes = Math.max(player.longestPositionMinutes, heldMinutes);
    }

    const trade: Trade = {
      id: `${player.id}-${pair}-close-${Date.now()}`,
      playerName: player.name,
      playerColor: player.color,
      pair,
      side: existing.side,
      size: existing.size,
      price: existing.markPrice,
      fee: 0,
      leverage: existing.leverage,
      orderType: 'market',
      pnl: existing.pnl,
      time: Date.now(),
      action: 'close',
    };

    const tradeReturn = (existing.pnl / (existing.entryPrice * existing.size)) * 100;
    player.bestTradePercent = Math.max(player.bestTradePercent, tradeReturn);
    if (existing.pnl > 0) {
      player.biggestTradePnl = Math.max(player.biggestTradePnl, existing.pnl);
    }
    player.winStreak = existing.pnl > 0 ? player.winStreak + 1 : 0;
    player.trades.push(trade);
    player.trades = player.trades.slice(-50);
    player.openPositions = player.openPositions.filter((position) => position !== existing);
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
        size: existing.size,
        entryPrice: existing.entryPrice,
        action: 'close',
        pnl: existing.pnl,
      },
    };
  }

  private resetPlayers(players: Player[]): void {
    for (const player of players) {
      player.initialBalance = this.startingBalance;
      player.currentBalance = this.startingBalance;
      player.pnl = 0;
      player.pnlPercent = 0;
      player.tradeCount = 0;
      player.trades = [];
      player.openPositions = [];
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
    this.tickerPrices = await kraken.getTickers();
    for (const player of players) {
      this.updatePlayerEquity(player);
      player.connected = true;
      player.lastUpdate = Date.now();
    }
    this.onTick();
  }

  private updatePlayerEquity(player: Player): void {
    player.openPositions = player.openPositions.map((position) => {
      const symbol = pairToSymbol.get(position.pair);
      const markPrice = symbol ? this.tickerPrices[symbol] || position.markPrice : position.markPrice;
      const updated = {
        ...position,
        markPrice,
      };
      updated.pnl = computePositionPnl(updated);
      return updated;
    });

    const realizedPnl = getRealizedPnl(player);
    const unrealizedPnl = player.openPositions.reduce((total, position) => total + position.pnl, 0);
    const initialBalance = player.initialBalance ?? this.startingBalance;

    const pnlAdjustment = player.pnlAdjustment || 0;
    player.currentBalance = initialBalance + realizedPnl + unrealizedPnl + pnlAdjustment;
    player.pnl = player.currentBalance - initialBalance;
    player.pnlPercent = initialBalance > 0 ? (player.pnl / initialBalance) * 100 : 0;
  }
}
