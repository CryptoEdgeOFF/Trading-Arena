import { type PointerEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { createPortal } from 'react-dom';
import AdvancedChart, { type ChartLiveTickHandler, type ChartOrderPreview } from './AdvancedChart';
import { useWebSocket } from '../hooks/useWebSocket';
import { type MarketDataSource, type MarketTicker, type OrderType, type Player, type Position, type Trade, useGameStore } from '../stores/useGameStore';
import { formatPnl, formatTime, timeAgo } from '../utils/formatters';
import { EVENT_INTRO_COUNTDOWN_MS } from '../utils/liveEvent';
import { getMarketSession } from '../utils/marketHours';
import {
  engineSizeFromInput,
  fmtMarketPrice,
  formatEngineSizeDisplay,
  formatInputSize,
  inputSizeFromEngine,
  inputSizeStep,
  isLotBased,
  isValidStopLoss,
  isValidTakeProfit,
  priceToInputString,
  sizeUnitLabel,
} from '../utils/positionSizing';
import { refreshPlayerPaperMetrics } from '../utils/positionPnl';
import logoBtf from '../assets/pictures/logoBTF.webp';
import LiveEventTraderOverlay from './LiveEventTraderOverlay';
import { AvatarImage } from './OptimizedImage';
import { withDisplayWidth } from '../utils/imageUrl';
import {
  clearAllPaperSessions,
  clearPaperSessionToken,
  extractPaperCompetitionContext,
  getCompetitionIdFromUrl,
  getTerminalPlatformFromUrl,
  isPaperBootstrapCacheValid,
  paperSessionMatchesPlatform,
  readPaperBootstrapCache,
  readPaperSessionToken,
  type TerminalPlatform,
  writePaperSessionToken,
  buildCompeteTradeUrl,
} from '../lib/paperSession';

const DEMO_SESSION_KEY = 'btf-tradingview-review-demo';
const DEMO_PAIRS = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD'];
const DEMO_STARTING_BALANCE = 100_000;
const DEMO_TAKER_FEE = 0.00005 / 3;
const DEMO_MAKER_FEE = 0.00002 / 3;

/** Ordre limite passif : déclenchement au prix limite (pas de fill market immédiat). */
function isRestingLimitTriggered(
  side: 'long' | 'short',
  limitPrice: number,
  placedAtMark: number,
  markPrice: number,
): boolean {
  if (side === 'long') {
    if (placedAtMark >= limitPrice) return markPrice <= limitPrice;
    return markPrice >= limitPrice;
  }
  if (placedAtMark <= limitPrice) return markPrice >= limitPrice;
  return markPrice <= limitPrice;
}

interface PaperMeta {
  enabled: boolean;
  eventStarted: boolean;
  startingBalance: number;
  marketDataSource: MarketDataSource;
  pairs: string[];
  market: Record<string, MarketTicker>;
  marketMetadata: Record<string, MarketMetadata>;
  fees: {
    maker: number;
    taker: number;
    spreadBps: number;
    minLeverage: number;
    maxLeverage: number;
  };
}

interface MarketMetadata {
  pair: string;
  base: string;
  quote: string;
  name: string;
  coingeckoId: string;
  imageUrl: string | null;
  krakenSymbol: string;
  category?: 'crypto' | 'actions' | 'indices' | 'commodities' | 'forex';
  source?: 'kraken_futures' | 'binance_futures' | 'itick';
  sourceSymbol?: string;
  tradingViewSymbol?: string | null;
  sortOrder: number;
  enabled: boolean;
}

type MarketCategory = NonNullable<MarketMetadata['category']>;
type MobileTerminalTab = 'orders' | 'chart' | 'leaderboard';

const MARKET_CATEGORIES: { id: MarketCategory; label: string }[] = [
  { id: 'crypto', label: 'Crypto' },
  { id: 'actions', label: 'Actions' },
  { id: 'indices', label: 'Indices' },
  { id: 'commodities', label: 'Matières' },
  { id: 'forex', label: 'Forex' },
];

interface SessionPlayer {
  id: string;
  name: string;
  color: string;
  avatar: string | null;
}

interface CompetitionContext {
  id: string;
  title: string;
  mode: 'paper' | 'real';
  userId?: string | null;
  startAt?: number;
  endAt?: number;
  status?: 'upcoming' | 'live' | 'ended';
  rank?: number | null;
  participants?: number;
  pnlPercent?: number;
}

interface LeaderboardRow {
  rank: number;
  userId: string;
  name: string;
  avatarUrl?: string | null;
  pnlPercent: number;
  pnlUsd: number;
  tradesCount: number;
  updatedAt: number;
}

interface LeaderboardResponse {
  competition: {
    id: string;
    title: string;
    code: string;
    startAt: number;
    endAt: number;
    status: 'upcoming' | 'live' | 'ended';
    participants: number;
  };
  leaderboard: LeaderboardRow[];
}

interface ExchangeTerminalProps {
  demoMode?: boolean;
}

const PAIR_BASE: Record<string, string> = {
  'BTC/USD': 'BTC',
  'ETH/USD': 'ETH',
  'SOL/USD': 'SOL',
  'XRP/USD': 'XRP',
};

const PAIR_COLOR: Record<string, string> = {
  'BTC/USD': '#f7931a',
  'ETH/USD': '#627eea',
  'SOL/USD': '#9945ff',
  'XRP/USD': '#23292f',
};

const PAIR_NAME: Record<string, string> = {
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  XRP: 'Ripple',
  BNB: 'BNB',
  SOL: 'Solana',
  DOGE: 'Dogecoin',
  ADA: 'Cardano',
  TRX: 'Tron',
  LINK: 'Chainlink',
  AVAX: 'Avalanche',
  XLM: 'Stellar',
  BCH: 'Bitcoin Cash',
  DOT: 'Polkadot',
  LTC: 'Litecoin',
  SUI: 'Sui',
  HBAR: 'Hedera',
  TON: 'Toncoin',
  SHIB: 'Shiba Inu',
  UNI: 'Uniswap',
  AAVE: 'Aave',
  NEAR: 'Near Protocol',
  APT: 'Aptos',
  ICP: 'Internet Computer',
  ETC: 'Ethereum Classic',
  POL: 'Polygon',
  FET: 'Fetch.ai',
  RENDER: 'Render',
  ONDO: 'Ondo',
  FIL: 'Filecoin',
  ARB: 'Arbitrum',
  ATOM: 'Cosmos',
  OP: 'Optimism',
  INJ: 'Injective',
  WLD: 'Worldcoin',
  SEI: 'Sei',
  IMX: 'Immutable',
  GRT: 'The Graph',
  ALGO: 'Algorand',
  SAND: 'The Sandbox',
  MANA: 'Decentraland',
  QNT: 'Quant',
  STX: 'Stacks',
  LDO: 'Lido DAO',
  RUNE: 'Thorchain',
  APE: 'ApeCoin',
  PENDLE: 'Pendle',
  TIA: 'Celestia',
  JUP: 'Jupiter',
  PYTH: 'Pyth Network',
  BONK: 'Bonk',
};

function pairBase(pair: string): string {
  return PAIR_BASE[pair] || pair.split('/')[0] || pair;
}

function TokenIcon({ pair, imageUrl, size = 'h-7 w-7' }: { pair: string; imageUrl?: string | null; size?: string }) {
  const base = pairBase(pair);
  if (imageUrl) {
    const src = withDisplayWidth(imageUrl, 56) || imageUrl;
    return <img src={src} alt={base} className={`${size} shrink-0 rounded-full object-cover`} loading="lazy" decoding="async" fetchPriority="low" />;
  }
  return (
    <span className={`${size} flex shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white`} style={{ background: PAIR_COLOR[pair] || '#2c2638' }}>
      {base.slice(0, 1)}
    </span>
  );
}

const DEMO_PRICE_BASE: Record<string, { price: number; volatility: number }> = {
  'BTC/USD': { price: 96_420, volatility: 38 },
  'ETH/USD': { price: 3_420, volatility: 2.6 },
  'SOL/USD': { price: 187.4, volatility: 0.2 },
  'XRP/USD': { price: 2.42, volatility: 0.006 },
};

function createDemoMarket(): Record<string, MarketTicker> {
  return Object.fromEntries(DEMO_PAIRS.map((pair) => {
    const base = DEMO_PRICE_BASE[pair];
    return [pair, {
      pair,
      symbol: pair.replace('/', ''),
      markPrice: base.price,
      bidPrice: base.price * 0.99995,
      askPrice: base.price * 1.00005,
      spreadBps: 1,
      updatedAt: Date.now(),
    }];
  })) as Record<string, MarketTicker>;
}

function createDemoPlayer(): Player {
  return {
    id: 'tradingview-demo',
    name: 'TradingView Demo',
    color: '#dc2626',
    avatar: null,
    active: true,
    initialBalance: DEMO_STARTING_BALANCE,
    currentBalance: DEMO_STARTING_BALANCE,
    availableMargin: DEMO_STARTING_BALANCE,
    usedMargin: 0,
    feesPaid: 0,
    pnl: 0,
    pnlPercent: 0,
    tradeCount: 0,
    trades: [],
    openPositions: [],
    openOrders: [],
    rank: 1,
    previousRank: 1,
    badges: [],
    winStreak: 0,
    longestPositionMinutes: 0,
    biggestTradePnl: 0,
    bestTradePercent: 0,
    lastUpdate: Date.now(),
    connected: true,
  };
}

function positionPnl(position: Position, markPrice: number): number {
  const direction = position.side === 'long' ? 1 : -1;
  return (markPrice - position.entryPrice) * position.size * direction;
}

function normalizeDemoPlayer(player: Player, market: Record<string, MarketTicker>): Player {
  const openPositions = player.openPositions.map((position) => {
    const markPrice = market[position.pair]?.markPrice ?? position.markPrice;
    return {
      ...position,
      markPrice,
      pnl: positionPnl(position, markPrice),
    };
  });
  const usedMargin = openPositions.reduce((sum, position) => sum + position.margin, 0);
  const openPnl = openPositions.reduce((sum, position) => sum + position.pnl, 0);
  const realizedPnl = player.trades.reduce((sum, trade) => sum + (trade.action === 'close' ? trade.pnl - trade.fee : -trade.fee), 0);
  const equity = DEMO_STARTING_BALANCE + realizedPnl + openPnl;

  return {
    ...player,
    currentBalance: equity,
    availableMargin: Math.max(0, equity - usedMargin),
    usedMargin,
    pnl: equity - DEMO_STARTING_BALANCE,
    pnlPercent: ((equity - DEMO_STARTING_BALANCE) / DEMO_STARTING_BALANCE) * 100,
    openPositions,
    lastUpdate: Date.now(),
  };
}

function loadDemoPlayer(market: Record<string, MarketTicker>): Player {
  if (typeof window === 'undefined') return normalizeDemoPlayer(createDemoPlayer(), market);
  try {
    const raw = window.localStorage.getItem(DEMO_SESSION_KEY);
    if (!raw) return normalizeDemoPlayer(createDemoPlayer(), market);
    const parsed = JSON.parse(raw) as Player;
    return normalizeDemoPlayer({
      ...createDemoPlayer(),
      ...parsed,
      openPositions: (parsed.openPositions || []).map((position) => ({
        ...position,
        id: position.id || crypto.randomUUID(),
      })),
    }, market);
  } catch {
    return normalizeDemoPlayer(createDemoPlayer(), market);
  }
}

function fmt(value: number | null | undefined, frac = 1): string {
  if (value == null || !Number.isFinite(value)) return '–';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: frac,
    maximumFractionDigits: frac,
  });
}

function priceInputValue(value: number | null | undefined, category?: string): string {
  return priceToInputString(value, category);
}

function fmtSigned(value: number, frac = 2): string {
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${fmt(value, frac)}`;
}

/* ------------------------------------------------------------------ ICONS */

function Icon({ d, viewBox = '0 0 24 24', size = 16 }: { d: string; viewBox?: string; size?: number }) {
  return (
    <svg viewBox={viewBox} width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6">
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

const ICONS = {
  star:    'M12 3l2.6 5.6 6.1.6-4.6 4.2 1.4 6L12 16.7 6.5 19.4 7.9 13.4 3.3 9.2l6.1-.6L12 3z',
  expand:  'M9 3H3v6 M21 15v6h-6 M21 3l-7 7 M3 21l7-7',
  plus:    'M12 5v14 M5 12h14',
  close:   'M6 6l12 12 M6 18L18 6',
  chevron: 'M6 9l6 6 6-6',
};

/* ------------------------------------------------------------------ TOP BAR */

function TopBar({
  player,
  trader,
  competition,
  liveMode = false,
  onLogout,
}: {
  player: Player | null;
  trader: SessionPlayer;
  competition: CompetitionContext | null;
  liveMode?: boolean;
  onLogout?: () => void;
}) {
  const eventEndTime = useGameStore((s) => s.eventEndTime);
  const eventStarted = useGameStore((s) => s.eventStarted);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!liveMode || !eventStarted || eventEndTime == null) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [liveMode, eventStarted, eventEndTime]);

  const remainingMs = eventEndTime != null ? Math.max(0, eventEndTime - now) : null;
  const balance = player?.currentBalance ?? 0;
  const pnl = player?.pnl ?? 0;
  const pnlPct = player?.pnlPercent ?? 0;
  const pnlPos = pnl >= 0;
  const rank = competition?.rank ?? player?.rank ?? null;
  const participants = competition?.participants ?? null;
  const homeHref = '/compete';
  const leaderboardHref = competition?.id && competition.id !== 'unknown'
    ? `/compete/leaderboard/${competition.id}`
    : '/compete';

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-2 rounded-2xl border border-[#2a2236] bg-[#0b0711]/95 px-2.5 py-2 shadow-[0_18px_60px_-45px_rgba(220,38,38,0.8)] backdrop-blur md:px-3 md:py-1.5">
      <div className="flex items-center gap-2">
        <img src={logoBtf} alt="BTF" className="h-8 w-8 rounded object-contain" />
        <div className="leading-tight">
          <div className="font-rajdhani text-[15px] font-bold tracking-wide text-white">BTF Trade</div>
          <div className="text-[9px] uppercase tracking-[0.18em] text-[#7a8090]">Terminal</div>
        </div>
      </div>

      <div className="hidden min-w-0 md:block">
        <div className="truncate text-[13px] font-semibold text-white">
          {liveMode ? 'BTF Live event' : (competition?.title || 'Trading terminal')}
        </div>
        <div className="text-[10px] uppercase tracking-[0.16em] text-[#7a8090]">
          {liveMode
            ? 'Trader access'
            : (competition?.status === 'live' ? 'Competition live' : competition?.status === 'upcoming' ? 'Competition a venir' : 'Paper trading')}
        </div>
      </div>

      <div className="order-3 grid w-full grid-cols-3 overflow-hidden rounded-xl border border-[#241e30] bg-[#15121f] md:order-none md:ml-auto md:w-auto md:min-w-[360px]">
        <div className="border-r border-[#241e30] px-2 py-1.5 md:px-3">
          <div className="text-[9px] uppercase tracking-[0.16em] text-[#7a8090]">Solde</div>
          <div className="num truncate text-[11px] font-semibold text-white md:text-[13px]">{fmt(balance, 2)} <span className="text-[9px] text-[#7a8090] md:text-[10px]">USD</span></div>
        </div>
        <div className="border-r border-[#241e30] px-2 py-1.5 md:px-3">
          <div className="text-[9px] uppercase tracking-[0.16em] text-[#7a8090]">PNL</div>
          <span className="num block truncate text-[11px] font-semibold md:text-[13px]" style={{ color: pnlPos ? '#15c990' : '#f43f6e' }}>
            {pnlPos ? '+' : ''}{pnl.toFixed(2)} <span className="hidden text-[10px] sm:inline">({pnlPos ? '+' : ''}{pnlPct.toFixed(2)}%)</span>
          </span>
        </div>
        <div className="px-2 py-1.5 md:px-3">
          <div className="text-[9px] uppercase tracking-[0.16em] text-[#7a8090]">Rank</div>
          <div className="num truncate text-[11px] font-semibold text-white md:text-[13px]">
            {rank ? `#${rank}` : '–'} {participants !== null && <span className="text-[10px] text-[#7a8090]">/ {participants}</span>}
          </div>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-1.5 md:ml-0">
        {liveMode && remainingMs != null && (
          <div className={`rounded-xl border px-3 py-1.5 text-center ${remainingMs <= 60_000 ? 'border-red-500/40 bg-red-500/10' : 'border-[#241e30] bg-[#181517]'}`}>
            <div className="text-[8px] uppercase tracking-[0.16em] text-[#7a8090]">Restant</div>
            <div className="num text-[12px] font-bold text-white">{formatTime(remainingMs)}</div>
          </div>
        )}
        {liveMode ? (
          <button
            type="button"
            onClick={onLogout}
            className="cursor-pointer rounded-xl border border-[#241e30] bg-[#181517] px-3 py-1.5 text-[11px] font-semibold text-[#e0e2ea] transition-colors hover:border-red-500/50 hover:text-white"
          >
            Déconnexion
          </button>
        ) : (
          <>
            <a href={homeHref} className="cursor-pointer rounded-xl border border-[#241e30] bg-[#181517] px-3 py-1.5 text-[11px] font-semibold text-[#e0e2ea] transition-colors hover:border-[#dc2626]/50 hover:text-white">
              Accueil
            </a>
            <a href={leaderboardHref} className="cursor-pointer rounded-xl border border-[#dc2626]/35 bg-[#dc2626]/15 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:border-[#ef4444] hover:bg-[#dc2626]/25">
              Leaderboard
            </a>
          </>
        )}
        <div className="hidden items-center gap-2 px-2 text-[11.5px] text-[#e0e2ea] xl:flex">
          {trader.avatar ? (
            <img
              src={trader.avatar}
              alt=""
              className="h-6 w-6 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span className="h-6 w-6 shrink-0 rounded-full" style={{ background: trader.color }} />
          )}
          <span className="max-w-[110px] truncate">{trader.name}</span>
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ ORDER FORM */

interface OrderFormProps {
  meta: PaperMeta;
  pairs: string[];
  selectedPair: string;
  setSelectedPair: (pair: string) => void;
  side: 'long' | 'short';
  setSide: (side: 'long' | 'short') => void;
  orderType: OrderType;
  setOrderType: (type: OrderType) => void;
  size: string;
  setSize: (size: string) => void;
  limitPrice: string;
  setLimitPrice: (price: string) => void;
  leverage: number;
  setLeverage: (lev: number) => void;
  ticker: MarketTicker | undefined;
  player: Player | null;
  busy: boolean;
  eventStarted: boolean;
  error: string;
  onSubmit: (extras?: { stopLoss: number | null; takeProfit: number | null }) => void;
  onPreviewChange: (preview: ChartOrderPreview | null) => void;
  tpSlEnabled: boolean;
  setTpSlEnabled: (enabled: boolean | ((value: boolean) => boolean)) => void;
  takeProfitInput: string;
  setTakeProfitInput: (value: string) => void;
  stopLossInput: string;
  setStopLossInput: (value: string) => void;
}

/* ------------------------------------------------------------------ PAIR SELECTOR */

/**
 * Same dropdown as the order form's pair picker (categories pills, search,
 * scrollable list with live price + 24h change), reusable from anywhere.
 * Keeps its own open / search / category state so multiple instances don't
 * fight over a shared store.
 */
function PairSelectorMenu({
  selectedPair,
  pairs,
  marketMetadata,
  market,
  onChange,
  className = '',
}: {
  selectedPair: string;
  pairs: string[];
  marketMetadata: Record<string, MarketMetadata>;
  market: Record<string, MarketTicker>;
  onChange: (pair: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<MarketCategory>(
    (marketMetadata[selectedPair]?.category as MarketCategory) || 'crypto',
  );

  // Re-sync the active category whenever the controlled selectedPair changes
  // from outside (e.g. another instance picked a forex pair).
  useEffect(() => {
    const next = marketMetadata[selectedPair]?.category as MarketCategory | undefined;
    if (next) setActiveCategory(next);
  }, [selectedPair, marketMetadata]);

  // Recalcule « Marché fermé » à l'ouverture/fermeture des sessions (sans tick).
  const [, setSessionClock] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setSessionClock((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const availableCategories = MARKET_CATEGORIES.filter((category) =>
    pairs.some((pair) => (marketMetadata[pair]?.category || 'crypto') === category.id),
  );

  const filteredPairs = useMemo(() => {
    const query = search.trim().toLowerCase();
    const categoryPairs = pairs.filter(
      (pair) => (marketMetadata[pair]?.category || 'crypto') === activeCategory,
    );
    if (!query) return categoryPairs;
    const compactQuery = query.replace(/[\s/_-]/g, '');
    return categoryPairs.filter((pair) => {
      const baseLabel = pairBase(pair);
      const fullName = marketMetadata[pair]?.name || PAIR_NAME[baseLabel] || '';
      const values = [
        pair,
        pair.replace('/', ''),
        baseLabel,
        fullName,
        `${baseLabel}/USD`,
        `${baseLabel}USD`,
      ];
      return values.some((value) => {
        const normalized = value.toLowerCase();
        return normalized.includes(query) || normalized.replace(/[\s/_-]/g, '').includes(compactQuery);
      });
    });
  }, [activeCategory, marketMetadata, search, pairs]);

  return (
    <div className={`relative z-40 ${className}`}>
      {open && (
        <button
          type="button"
          aria-label="Fermer le menu des marches"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 cursor-default bg-transparent"
          tabIndex={-1}
        />
      )}
      <div className="relative z-40">
        <button
          type="button"
          onClick={() => {
            setOpen((value) => !value);
            setSearch('');
          }}
          className="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-[#241e30] bg-[#171320] px-3 py-1.5 text-left text-[12px] font-semibold text-white transition-colors hover:border-[#3a3148]"
        >
          <TokenIcon pair={selectedPair} imageUrl={marketMetadata[selectedPair]?.imageUrl} size="h-5 w-5" />
          <span className="truncate">{selectedPair}</span>
          <span className="ml-auto text-[#7a8090]"><Icon d={ICONS.chevron} size={12} /></span>
        </button>

        {open && (
          <div className="fixed left-2 right-2 top-[106px] z-50 max-h-[calc(100dvh-122px)] overflow-hidden rounded-2xl border border-[#30283d] bg-[#171320] shadow-[0_22px_70px_-35px_rgba(0,0,0,0.95)] sm:absolute sm:left-0 sm:right-auto sm:top-[calc(100%+8px)] sm:w-[430px] sm:max-h-none">
            <button
              type="button"
              aria-label="Fermer"
              onClick={() => setOpen(false)}
              className="absolute right-2 top-2 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-[#332b43] bg-[#1d1828] text-[#c8c0d8] transition-colors hover:border-[#dc2626]/60 hover:text-white"
            >
              <Icon d={ICONS.close} size={14} />
            </button>
            <div className="flex items-center gap-1.5 overflow-x-auto border-b border-[#241e30] px-2 py-2 pr-12 sm:gap-2 sm:px-3 sm:pr-12">
              {availableCategories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setActiveCategory(category.id)}
                  className={`shrink-0 rounded-xl border px-3 py-2 text-[11px] font-bold transition-colors sm:px-4 sm:text-[12px] ${
                    activeCategory === category.id
                      ? 'border-white/10 bg-white text-[#171320] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]'
                      : 'border-[#332b43] bg-[#211b2b] text-[#c8c0d8] hover:border-[#4a405d]'
                  }`}
                >
                  {category.label}
                </button>
              ))}
            </div>

            <div className="border-b border-[#241e30] px-3 py-2">
              <div className="flex h-9 items-center gap-2 rounded-xl border border-[#30283d] bg-[#100c18] px-3 focus-within:border-[#dc2626]/60">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#746d82]">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.3-4.3M10.8 18a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4Z" />
                </svg>
                <input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Rechercher BTC, Bitcoin, ETH..."
                  className="h-full w-full bg-transparent text-[12px] font-semibold text-white outline-none placeholder:text-[#5f586d]"
                />
              </div>
            </div>

            <div className="grid grid-cols-[1fr_92px] border-b border-[#241e30] px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-[#6f687f] sm:grid-cols-[1fr_120px] sm:px-4">
              <span>{MARKET_CATEGORIES.find((entry) => entry.id === activeCategory)?.label || 'Marchés'}</span>
              <span className="text-right">Dernier prix</span>
            </div>

            <div className="max-h-[calc(100dvh-270px)] overflow-y-auto py-1 sm:max-h-[360px]">
              {filteredPairs.map((pair) => {
                const baseLabel = pairBase(pair);
                const quoteLabel = pair.split('/')[1] || 'USD';
                const metadata = marketMetadata[pair];
                const fullName = metadata?.name || PAIR_NAME[baseLabel] || 'Crypto perpetual';
                const marketTicker = market[pair];
                const marketPrice = marketTicker?.markPrice;
                const change24h = marketTicker?.change24h;
                const changePositive = (change24h ?? 0) >= 0;
                const category = metadata?.category || 'crypto';
                const marketOpen = marketTicker?.marketOpen ?? getMarketSession(pair, { category }).open;
                const active = pair === selectedPair;
                return (
                  <button
                    key={pair}
                    type="button"
                    onClick={() => {
                      onChange(pair);
                      setOpen(false);
                      setSearch('');
                    }}
                    className={`grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_92px] items-center gap-2 px-3 py-2.5 text-left transition-colors sm:grid-cols-[1fr_120px] sm:gap-3 sm:px-4 ${active ? 'bg-[#241d30]' : 'hover:bg-[#211a2b]'} ${!marketOpen ? 'opacity-60' : ''}`}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <TokenIcon pair={pair} imageUrl={metadata?.imageUrl} />
                      <span className="min-w-0">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-[13px] font-bold text-white">{baseLabel}<span className="text-[#8b8498]">/{quoteLabel}</span></span>
                          {!marketOpen ? (
                            <span className="shrink-0 rounded-md bg-[#3d2a14] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#fbbf24]">
                              Marché fermé
                            </span>
                          ) : change24h != null && (
                            <span className={`num shrink-0 text-[11px] font-semibold ${changePositive ? 'text-[#15c990]' : 'text-[#f43f6e]'}`}>
                              {changePositive ? '+' : ''}{change24h.toFixed(2)}%
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-[11px] text-[#746d82]">{fullName}</span>
                      </span>
                    </span>
                    <span className="num truncate text-right text-[11px] font-semibold text-[#ece8f5] sm:text-[12.5px]">
                      {!marketOpen
                        ? '—'
                        : marketPrice
                          ? `${fmt(marketPrice, marketPrice >= 100 ? 2 : 4)} ${quoteLabel}`
                          : '–'}
                    </span>
                  </button>
                );
              })}
              {filteredPairs.length === 0 && (
                <div className="px-4 py-8 text-center text-[12px] text-[#746d82]">
                  Aucune paire trouvée.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AccountSizeSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (percent: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  const updateFromClientX = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const { left, width } = track.getBoundingClientRect();
    if (width <= 0) return;
    const pct = Math.round(Math.max(0, Math.min(100, ((clientX - left) / width) * 100)));
    onChange(pct);
  }, [onChange]);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromClientX(event.clientX);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    updateFromClientX(event.clientX);
  };

  const presets = [25, 50, 75, 100];

  return (
    <div className="select-none">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span className="text-[11px] text-[#9f98af]">Account size</span>
        <div className="flex items-center gap-1">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => onChange(preset)}
              className={`cursor-pointer rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums transition-colors ${
                value === preset
                  ? 'bg-[#f43f6e]/18 text-[#ff8fb0]'
                  : 'text-[#6f687e] hover:bg-[#241e30] hover:text-[#c8c2d4]'
              }`}
            >
              {preset}%
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-[#241e30] bg-[#15121f] px-3 py-2">
        <div
          ref={trackRef}
          className="relative h-6 cursor-pointer touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          role="slider"
          aria-label="Taille de position"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={value}
        >
          <div className="absolute inset-x-0 top-1/2 h-[4px] -translate-y-1/2 overflow-hidden rounded-full bg-[#252030]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#f43f6e] via-[#e0448a] to-[#a855f7]"
              style={{ width: `${value}%` }}
            />
          </div>

          <div
            className="absolute top-1/2 z-10"
            style={{
              left: `${value}%`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <div className="flex h-6 min-w-[42px] items-center justify-center rounded-full border-2 border-[#10091c] bg-white px-2 shadow-[0_2px_8px_rgba(0,0,0,0.4)] ring-2 ring-[#f43f6e]/20">
              <span className="num text-[10px] font-bold leading-none tabular-nums text-[#15121f]">
                {value}%
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function OrderForm(props: OrderFormProps) {
  const {
    meta, pairs, selectedPair, setSelectedPair,
    side, setSide, orderType, setOrderType,
    size, setSize, limitPrice, setLimitPrice,
    leverage, setLeverage: _setLeverage, ticker, player,
    busy, eventStarted, error, onSubmit, onPreviewChange,
    tpSlEnabled, setTpSlEnabled,
    takeProfitInput, setTakeProfitInput,
    stopLossInput, setStopLossInput,
  } = props;

  const isSell = side === 'short';
  const SELL = '#f43f6e';
  const BUY = '#18c98e';
  const accent = isSell ? SELL : BUY;
  const [accountPercent, setAccountPercent] = useState(0);
  const [usdAmount, setUsdAmount] = useState('');
  const [lastEditedAmount, setLastEditedAmount] = useState<'qty' | 'usd'>('qty');

  const category = meta.marketMetadata[selectedPair]?.category || 'crypto';
  const lotBased = isLotBased(selectedPair);

  const [, setSessionClock] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setSessionClock((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const marketOpen = ticker?.marketOpen ?? getMarketSession(selectedPair, { category }).open;

  const qty = Number(size) || 0;
  const engineQty = engineSizeFromInput(selectedPair, qty);
  const refPrice = orderType === 'market'
    ? (side === 'long' ? ticker?.askPrice ?? ticker?.markPrice ?? 0 : ticker?.bidPrice ?? ticker?.markPrice ?? 0)
    : Number(limitPrice) || 0;
  const total = refPrice * engineQty;
  const margin = leverage > 0 ? total / leverage : 0;
  const fee = total * (orderType === 'market' ? meta.fees.taker : meta.fees.maker);
  const available = (player?.availableMargin ?? 0);
  const maxNotional = available * leverage;
  const maxEngineQty = refPrice > 0 ? maxNotional / refPrice : 0;
  const approxSizeLabel = lotBased
    ? `${inputSizeFromEngine(selectedPair, maxEngineQty).toFixed(2)} lots`
    : `${maxEngineQty.toFixed(5)} ${pairBase(selectedPair)}`;
  const usedRatio = available > 0 ? Math.min(1, margin / available) : 0;
  const base = pairBase(selectedPair);
  const sizeLabel = lotBased ? 'Lots' : 'Quantité';
  const sizeUnit = sizeUnitLabel(selectedPair, base);
  const sizeStep = inputSizeStep(selectedPair);
  const canSubmit = eventStarted && marketOpen && Number.isFinite(qty) && qty > 0;

  useEffect(() => {
    setAccountPercent(Math.round(usedRatio * 100));
  }, [usedRatio]);

  useEffect(() => {
    const qty = Number(size) || 0;
    if (qty <= 0) {
      setAccountPercent(0);
      setUsdAmount('');
      setLastEditedAmount('qty');
    }
  }, [size]);

  useEffect(() => {
    if (lastEditedAmount === 'usd') return;
    setUsdAmount(total > 0 ? total.toFixed(2) : '');
  }, [lastEditedAmount, total]);

  useEffect(() => {
    if (lastEditedAmount !== 'usd') return;
    const usd = Number(usdAmount);
    if (!Number.isFinite(usd) || usd <= 0 || refPrice <= 0) return;
    const nextEngineQty = usd / refPrice;
    setSize(formatInputSize(selectedPair, inputSizeFromEngine(selectedPair, nextEngineQty)));
  }, [selectedPair, lastEditedAmount, refPrice, setSize, usdAmount]);

  useEffect(() => {
    setAccountPercent(0);
    setUsdAmount('');
    setLastEditedAmount('qty');
    if (isLotBased(selectedPair)) setSize('0.01');
    else setSize('0.00005');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reset sizing only when the pair changes
  }, [selectedPair]);

  useEffect(() => {
    const tpRaw = Number(takeProfitInput);
    const slRaw = Number(stopLossInput);
    const tpCandidate = tpSlEnabled && Number.isFinite(tpRaw) && tpRaw > 0 ? tpRaw : null;
    const slCandidate = tpSlEnabled && Number.isFinite(slRaw) && slRaw > 0 ? slRaw : null;
    const takeProfit = isValidTakeProfit(side, refPrice, tpCandidate) ? tpCandidate : null;
    const stopLoss = isValidStopLoss(side, refPrice, slCandidate) ? slCandidate : null;

    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(refPrice) || refPrice <= 0) {
      onPreviewChange(null);
      return;
    }

    if (orderType === 'market' && stopLoss == null && takeProfit == null) {
      onPreviewChange(null);
      return;
    }

    onPreviewChange({
      pair: selectedPair,
      side,
      orderType,
      entryPrice: refPrice,
      size: engineQty,
      stopLoss,
      takeProfit,
    });

    return () => onPreviewChange(null);
  }, [
    onPreviewChange,
    orderType,
    engineQty,
    refPrice,
    selectedPair,
    side,
    stopLossInput,
    takeProfitInput,
    tpSlEnabled,
  ]);

  function applyAccountPercent(percent: number) {
    const clamped = Math.max(0, Math.min(100, percent));
    setAccountPercent(clamped);

    if (!refPrice || refPrice <= 0 || !Number.isFinite(refPrice) || available <= 0) {
      setSize('0');
      return;
    }

    // Percent controls margin usage; position notional scales with leverage.
    const targetMargin = available * (clamped / 100);
    const targetNotional = targetMargin * leverage;
    const nextEngineQty = targetNotional / refPrice;
    setLastEditedAmount('qty');
    setSize(formatInputSize(selectedPair, inputSizeFromEngine(selectedPair, nextEngineQty)));
  }

  function applyUsdAmount(value: string) {
    setLastEditedAmount('usd');
    setUsdAmount(value);
    const usd = Number(value);
    if (!Number.isFinite(usd) || usd <= 0 || refPrice <= 0) {
      setSize('');
      return;
    }
    const nextEngineQty = usd / refPrice;
    setSize(formatInputSize(selectedPair, inputSizeFromEngine(selectedPair, nextEngineQty)));
  }

  return (
    <section className="flex w-full min-w-0 shrink-0 flex-col overflow-hidden rounded-2xl border border-[#2a2236] bg-[#10091c] lg:w-[470px]">
      <div className="flex-1 overflow-y-auto px-3 pb-3 pt-3">
        <div className="mb-2 flex items-center gap-2">
          <PairSelectorMenu
            selectedPair={selectedPair}
            pairs={pairs}
            marketMetadata={meta.marketMetadata}
            market={meta.market}
            onChange={setSelectedPair}
          />
          <div className="ml-auto flex items-center gap-1 rounded-lg border border-[#241e30] bg-[#171320] px-1.5 py-0.5 sm:gap-1.5 sm:rounded-xl sm:px-2.5 sm:py-1">
            <span className="hidden text-[9px] font-medium uppercase tracking-[0.12em] text-[#7a8090] sm:inline">Powered by</span>
            <img
              src="/assets/pictures/Kraken%20Logo_White.png"
              alt="Kraken"
              className="h-2.5 object-contain opacity-90 sm:h-4"
            />
          </div>
        </div>

        {/* Buy / Sell */}
        <div className="grid grid-cols-[1fr_1fr_1.35fr] gap-1.5 rounded-2xl border border-[#241e30] bg-[#14111d] p-1.5">
          <button
            type="button"
            onClick={() => setSide('long')}
            className="h-10 cursor-pointer rounded-xl text-[14px] font-semibold transition-colors"
            style={{
              background: !isSell ? '#20473f' : '#1c1828',
              color: !isSell ? '#5af0a6' : '#8d879c',
            }}
          >
            Buy
          </button>
          <button
            type="button"
            onClick={() => setSide('short')}
            className="h-10 cursor-pointer rounded-xl text-[14px] font-semibold transition-colors"
            style={{
              background: isSell ? '#4a2337' : '#1c1828',
              color: isSell ? '#ff83a7' : '#8d879c',
            }}
          >
            Sell
          </button>
          <div className="relative">
            <select
              value={orderType}
              onChange={(event) => setOrderType(event.target.value as OrderType)}
              className="h-10 w-full cursor-pointer appearance-none rounded-xl border border-[#241e30] bg-[#1c1828] pl-3 pr-8 text-[14px] font-semibold text-white outline-none"
            >
              <option value="market">Market</option>
              <option value="limit">Limit</option>
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#7a8090]">
              <Icon d={ICONS.chevron} size={12} />
            </span>
          </div>
        </div>

        {/* Solde + marge */}
        <div className="mt-2.5 rounded-xl border border-[#241e30] bg-[#15121f] px-2.5 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[10.5px]">
            <span className="text-[#9498a4]">Marge <span className="num text-white">{fmt(available, 0)} USD</span></span>
            <span className="text-[#9498a4]">Levier <span className="num text-white">{leverage}x</span></span>
            <span className="text-[#9498a4]">Pouvoir max <span className="num font-semibold text-[#67dd88]">{fmt(maxNotional, 0)} USD</span></span>
          </div>
          <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-[#282333]">
            <div className="h-full" style={{ width: `${(1 - usedRatio) * 100}%`, background: BUY }} />
          </div>
          <div className="mt-1 flex justify-between text-[9.5px] text-[#6f687f]">
            <span>Utilisé par l’ordre: {fmt(margin, 2)} USD</span>
            <span>≈ {approxSizeLabel}</span>
          </div>
        </div>

        {/* Prix du marché */}
        {!marketOpen && (
          <div className="mt-3 rounded-xl border border-[#fbbf24]/25 bg-[#fbbf24]/10 px-3 py-2 text-center text-[12px] font-semibold text-[#fbbf24]">
            Marché fermé — trading indisponible hors heures d&apos;ouverture
          </div>
        )}
        <div className="mt-3 px-1">
          <div className="text-[12px] text-[#7a8090]">{orderType === 'market' ? 'Prix du marché' : 'Prix limite'}</div>
          {orderType === 'market' ? (
            <div className="mt-1 flex h-9 items-center gap-1 rounded-md border border-[#1f1a2b] bg-[#15121f] px-3">
              <span className="text-[12px] text-[#7a8090]">≈</span>
              <span className="flex-1 text-[13px] text-[#9498a4]">{fmtMarketPrice(ticker?.markPrice, category)}</span>
              <span className="text-[10px] text-[#7a8090]">USD</span>
            </div>
          ) : (
            <div className="mt-1 flex h-9 items-center gap-1 rounded-md border border-[#1f1a2b] bg-[#15121f] px-3">
              <input
                type="number"
                value={limitPrice}
                onChange={(event) => setLimitPrice(event.target.value)}
                className="flex-1 bg-transparent text-[13px] text-white outline-none"
              />
              <span className="text-[10px] text-[#7a8090]">USD</span>
            </div>
          )}
        </div>

        {/* Quantité / Total */}
        <div className="mt-3 grid grid-cols-2 gap-2 px-1">
          <div>
            <div className="text-[12px] text-[#7a8090]">{sizeLabel}</div>
            <div className={`mt-1 flex h-9 items-center gap-1 rounded-md border bg-[#15121f] px-3 ${qty <= 0 ? 'border-[#f43f6e]/45' : 'border-[#1f1a2b]'}`}>
              <input
                type="number"
                min={sizeStep.min}
                step={sizeStep.step}
                value={size}
                onChange={(event) => {
                  setLastEditedAmount('qty');
                  setSize(event.target.value);
                }}
                className="w-full bg-transparent text-[13px] font-semibold text-white outline-none"
              />
              <span className="text-[10px] text-[#7a8090]">{sizeUnit}</span>
            </div>
          </div>
          <div>
            <div className="text-[12px] text-[#7a8090]">Montant USD</div>
            <div className="mt-1 flex h-9 items-center gap-1 rounded-md border border-[#1f1a2b] bg-[#15121f] px-3 focus-within:border-[#f43f6e]/60">
              <span className="text-[12px] text-[#7a8090]">=</span>
              <input
                type="number"
                min="0"
                step="1"
                value={usdAmount}
                onChange={(event) => applyUsdAmount(event.target.value)}
                onBlur={() => {
                  const usd = Number(usdAmount);
                  if (Number.isFinite(usd) && usd > 0) setUsdAmount(usd.toFixed(2));
                }}
                placeholder="0"
                className="w-full bg-transparent text-[13px] font-semibold text-white outline-none"
              />
              <span className="text-[10px] text-[#7a8090]">USD</span>
            </div>
          </div>
        </div>

        {/* Slider taille de position */}
        <div className="mt-3 px-1">
          <AccountSizeSlider
            value={accountPercent}
            onChange={applyAccountPercent}
          />
        </div>

        <button
          type="button"
          onClick={() => setTpSlEnabled((value) => !value)}
          className="mt-2.5 flex items-center gap-2 px-1 text-[12px] font-semibold text-white"
        >
          <span className={`flex h-4 w-4 items-center justify-center rounded-md border text-[10px] ${tpSlEnabled ? 'border-[#18a7df] bg-[#18a7df]/20 text-[#64d7ff]' : 'border-[#3a3448] text-[#7f778d]'}`}>
            {tpSlEnabled ? '✓' : ''}
          </span>
          TP/SL
        </button>

        {tpSlEnabled && (() => {
          const tp = Number(takeProfitInput);
          const sl = Number(stopLossInput);
          const tpEntered = Number.isFinite(tp) && tp > 0;
          const slEntered = Number.isFinite(sl) && sl > 0;
          const tpValid = !tpEntered || isValidTakeProfit(side, refPrice, tp);
          const slValid = !slEntered || isValidStopLoss(side, refPrice, sl);
          const tpPct = (tpEntered && refPrice > 0)
            ? ((isSell ? (refPrice - tp) : (tp - refPrice)) / refPrice) * 100
            : null;
          const slPct = (slEntered && refPrice > 0)
            ? ((isSell ? (sl - refPrice) : (refPrice - sl)) / refPrice) * 100
            : null;
          const tpHint = isSell ? 'TP doit être < prix de ref pour un short' : 'TP doit être > prix de ref pour un long';
          const slHint = isSell ? 'SL doit être > prix de ref pour un short' : 'SL doit être < prix de ref pour un long';
          return (
            <div className="mt-2 grid grid-cols-2 gap-1.5 px-1">
              <div className={`rounded-lg border bg-[#151221] px-2 py-1.5 ${tpValid ? 'border-[#241e30]' : 'border-[#f43f6e]/60'}`}>
                <div className="text-[10px] text-[#8f899e]">Take profit</div>
                <div className="mt-0.5 flex items-center justify-between">
                  <input
                    type="number"
                    value={takeProfitInput}
                    onChange={(event) => setTakeProfitInput(event.target.value)}
                    placeholder="0.00"
                    className="num w-full bg-transparent text-[13px] font-semibold text-white outline-none"
                  />
                  <span className="text-[10px] font-semibold text-[#8f899e]">USD</span>
                </div>
                {!tpValid && <div className="mt-0.5 text-[9px] leading-tight text-[#ff8ab9]">{tpHint}</div>}
              </div>
              <div className="rounded-lg border border-[#241e30] bg-[#151221] px-2 py-1.5">
                <div className="text-[10px] text-[#8f899e]">Distance entry</div>
                <div className="mt-0.5 flex items-center justify-between">
                  <span className={`num text-[13px] font-semibold ${tpPct == null ? 'text-[#7a8090]' : tpPct >= 0 ? 'text-[#15c990]' : 'text-[#f43f6e]'}`}>
                    {tpPct == null ? '0.0' : (tpPct >= 0 ? '+' : '') + tpPct.toFixed(2)}
                  </span>
                  <span className="text-[10px] font-semibold text-[#8f899e]">%</span>
                </div>
              </div>
              <div className={`rounded-lg border bg-[#151221] px-2 py-1.5 ${slValid ? 'border-[#241e30]' : 'border-[#f43f6e]/60'}`}>
                <div className="text-[10px] text-[#8f899e]">Stop loss</div>
                <div className="mt-0.5 flex items-center justify-between">
                  <input
                    type="number"
                    value={stopLossInput}
                    onChange={(event) => setStopLossInput(event.target.value)}
                    placeholder="0.00"
                    className="num w-full bg-transparent text-[13px] font-semibold text-white outline-none"
                  />
                  <span className="text-[10px] font-semibold text-[#8f899e]">USD</span>
                </div>
                {!slValid && <div className="mt-0.5 text-[9px] leading-tight text-[#ff8ab9]">{slHint}</div>}
              </div>
              <div className="rounded-lg border border-[#241e30] bg-[#151221] px-2 py-1.5">
                <div className="text-[10px] text-[#8f899e]">Distance entry</div>
                <div className="mt-0.5 flex items-center justify-between">
                  <span className={`num text-[13px] font-semibold ${slPct == null ? 'text-[#7a8090]' : 'text-[#f43f6e]'}`}>
                    {slPct == null ? '0.0' : '-' + Math.abs(slPct).toFixed(2)}
                  </span>
                  <span className="text-[10px] font-semibold text-[#8f899e]">%</span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Bouton */}
        {error && <div className="mt-3 rounded-md border border-[#c026d3]/30 bg-[#c026d3]/10 px-2 py-2 text-[11px] text-[#ff8ab9]">{error}</div>}
        <button
          type="button"
          onClick={() => {
            if (!Number.isFinite(qty) || qty <= 0) return;
            const tpRaw = Number(takeProfitInput);
            const slRaw = Number(stopLossInput);
            const tpCandidate = tpSlEnabled && Number.isFinite(tpRaw) && tpRaw > 0 ? tpRaw : null;
            const slCandidate = tpSlEnabled && Number.isFinite(slRaw) && slRaw > 0 ? slRaw : null;
            if (tpSlEnabled && tpCandidate != null && !isValidTakeProfit(side, refPrice, tpCandidate)) return;
            if (tpSlEnabled && slCandidate != null && !isValidStopLoss(side, refPrice, slCandidate)) return;
            onSubmit({
              stopLoss: slCandidate,
              takeProfit: tpCandidate,
            });
          }}
          disabled={busy || !canSubmit}
          className={`btn-primary-shadow ${!isSell ? 'is-buy' : ''} mt-3 flex h-12 w-full cursor-pointer items-center justify-center rounded-2xl text-[20px] font-bold tracking-tight text-[#0b1b12] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50`}
          style={{ background: isSell ? SELL : '#67dd88' }}
        >
          {!eventStarted
            ? 'Waiting event'
            : !marketOpen
              ? 'Marché fermé'
            : qty <= 0
              ? 'Enter quantity'
            : busy
              ? 'Sending...'
              : `${isSell ? 'Short (sell)' : 'Long (buy)'} ${pairBase(selectedPair)}`}
        </button>

        {/* Side total + frais */}
        <div className="mt-2.5 space-y-1 border-t border-[#1b1724] px-1 pt-2.5 text-[10.5px]">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-[#9498a4]">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
              Side total
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-[#e0e2ea]">
                {lotBased ? `${qty.toFixed(2)} lots` : `${engineQty.toFixed(5)} ${base}`}
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[#9498a4]" />
            <span className="text-[10px] text-[#15c990]">{fmt(available, 2)} USD</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[#9498a4]">Frais de trading estimés</span>
            <span className="text-[#e0e2ea]">{(fee / (ticker?.markPrice || 1)).toFixed(9)} {base}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[#9498a4]">Marge utilisée pour cet ordre</span>
            <span className="text-[#e0e2ea]">{fmt(margin, 2)} USD</span>
          </div>
        </div>
      </div>
      <div className="hidden">{pairs.length}{selectedPair}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ CHART AREA */

function ChartArea({
  pair,
  pairs,
  pairLabels,
  pairCategories,
  marketMetadata,
  ticker,
  market,
  player,
  orderPreview,
  onPreviewRiskChange,
  onPreviewEntryChange,
  onUpdateRisk,
  onUpdateOrderRisk,
  onUpdateOrderLimit,
  onCancelOrder,
  onClosePosition,
  onPairChange,
  interval,
  setInterval,
  isMobile = false,
  chartLiveTickRef,
}: {
  pair: string;
  pairs: string[];
  pairLabels?: Record<string, string>;
  pairCategories?: Record<string, string>;
  marketMetadata?: Record<string, MarketMetadata>;
  marketDataSource?: MarketDataSource;
  tradingViewSymbol?: string | null;
  ticker: MarketTicker | undefined;
  market?: Record<string, MarketTicker>;
  player: Player | null;
  orderPreview?: ChartOrderPreview | null;
  onPreviewRiskChange?: (patch: { stopLoss?: number | null; takeProfit?: number | null }) => void;
  onPreviewEntryChange?: (price: number) => void;
  onUpdateRisk: (
    positionId: string,
    stopLoss: number | null,
    takeProfit: number | null,
  ) => Promise<void> | void;
  onUpdateOrderRisk: (
    orderId: string,
    stopLoss: number | null,
    takeProfit: number | null,
  ) => Promise<void> | void;
  onUpdateOrderLimit: (orderId: string, limitPrice: number) => Promise<void> | void;
  onCancelOrder: (orderId: string) => Promise<void> | void;
  onClosePosition: (positionId: string, partialSize?: number) => Promise<void> | void;
  onPairChange?: (pair: string) => void;
  interval: number;
  setInterval: (interval: number) => void;
  isMobile?: boolean;
  chartLiveTickRef?: React.MutableRefObject<ChartLiveTickHandler | null>;
}) {
  const positions = player?.openPositions ?? [];
  const pendingOrders = (player?.openOrders ?? [])
    .filter((order) => order.status === 'open' && order.limitPrice != null)
    .map((order) => ({
      id: order.id,
      pair: order.pair,
      side: order.side,
      type: order.orderType as 'limit' | 'market' | 'stop' | 'stop_limit',
      price: order.limitPrice as number,
      size: order.size,
      status: order.status,
      stopLoss: order.stopLoss ?? null,
      takeProfit: order.takeProfit ?? null,
    }));

  return (
    <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#2a2236] bg-[#10091c]">
      {isMobile && onPairChange && marketMetadata && (
        // Quick asset switcher for the mobile "Graphique" tab — same dropdown
        // (categories pills + search + price list) as the order form, so the
        // experience is consistent across tabs.
        <div className="flex shrink-0 items-center gap-2 border-b border-[#2a2236] bg-[#0e0817] px-2 py-1.5">
          <PairSelectorMenu
            selectedPair={pair}
            pairs={pairs}
            marketMetadata={marketMetadata}
            market={market || {}}
            onChange={onPairChange}
            className="flex-1"
          />
          {ticker?.markPrice != null && (
            <span
              className="num shrink-0 text-[12px] font-semibold tabular-nums text-white"
              style={{
                color: (ticker.change24h ?? 0) >= 0 ? '#15c990' : '#f43f6e',
              }}
            >
              {fmtMarketPrice(ticker.markPrice, pairCategories?.[pair])}
            </span>
          )}
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <AdvancedChart
          pair={pair}
          pairs={pairs}
          pairLabels={pairLabels}
          pairCategories={pairCategories}
          ticker={ticker}
          market={market}
          positions={positions}
          pendingOrders={pendingOrders}
          orderPreview={orderPreview}
          onPreviewRiskChange={onPreviewRiskChange}
          onPreviewEntryChange={onPreviewEntryChange}
          intervalMinutes={interval}
          onIntervalChange={setInterval}
          onPairChange={onPairChange}
          onUpdateRisk={onUpdateRisk}
          onUpdateOrderRisk={onUpdateOrderRisk}
          onUpdateOrderLimit={onUpdateOrderLimit}
          onCancelOrder={onCancelOrder}
          onClosePosition={(positionId) => onClosePosition(positionId)}
          isMobile={isMobile}
          chartLiveTickRef={chartLiveTickRef}
        />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ POSITION ROW */

function PositionRow({
  position,
  category,
  ticker,
  busy,
  onClosePosition,
  onUpdateRisk,
  onSelectPair,
}: {
  position: Position;
  category?: MarketCategory;
  ticker: MarketTicker | undefined;
  busy: boolean;
  onClosePosition: (positionId: string, partialSize?: number) => void;
  onUpdateRisk: (
    positionId: string,
    stopLoss: number | null,
    takeProfit: number | null,
    options?: { stopLossSize?: number | null; takeProfitSize?: number | null },
  ) => Promise<void> | void;
  onSelectPair?: (pair: string) => void;
}) {
  const isLong = position.side === 'long';
  const accent = isLong ? '#15c990' : '#c026d3';
  const pnlPos = position.pnl >= 0;
  const currentPrice = ticker?.pair === position.pair ? ticker.markPrice : position.markPrice;
  const marketOpen = ticker?.marketOpen ?? getMarketSession(position.pair, { category }).open;
  const [panel, setPanel] = useState<'none' | 'close'>('none');
  const [riskOpen, setRiskOpen] = useState(false);
  const [closePercent, setClosePercent] = useState<number>(50);

  function pctFromPrice(target: number | null | undefined): number | null {
    if (target == null || !Number.isFinite(target) || !Number.isFinite(position.entryPrice) || position.entryPrice <= 0) return null;
    const raw = ((target - position.entryPrice) / position.entryPrice) * 100;
    return isLong ? raw : -raw;
  }

  const tpDisplay = position.takeProfit != null ? fmtMarketPrice(position.takeProfit, category) : '–';
  const slDisplay = position.stopLoss != null ? fmtMarketPrice(position.stopLoss, category) : '–';
  const tpPct = pctFromPrice(position.takeProfit);
  const slPct = pctFromPrice(position.stopLoss);
  const tpIsPartial = position.takeProfitSize != null && position.takeProfitSize > 0 && position.takeProfitSize < position.size;
  const slIsPartial = position.stopLossSize != null && position.stopLossSize > 0 && position.stopLossSize < position.size;
  const sizeDisplay = formatEngineSizeDisplay(position.pair, position.size, pairBase(position.pair));

  const PRESETS = [25, 50, 75, 100];
  const partialSize = Math.max(0, position.size * (closePercent / 100));
  const partialUsd = partialSize * currentPrice;

  return (
    <>
      <tr className="hover:bg-[#181517]">
        <Td>
          <button
            type="button"
            onClick={() => onSelectPair?.(position.pair)}
            className="flex items-center gap-2 rounded px-1 py-0.5 -mx-1 text-left transition-colors hover:bg-[#1f1b27]"
            title={`Afficher ${position.pair} sur le graphique`}
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ background: PAIR_COLOR[position.pair] || '#f7931a' }}>
              {pairBase(position.pair).slice(0, 1)}
            </span>
            <span className="text-white">{position.pair}</span>
            <span className="rounded-sm bg-[#231f22] px-1 py-px text-[9px] text-[#9498a4]">{position.leverage}x</span>
          </button>
        </Td>
        <Td><span style={{ color: accent }}>{isLong ? 'Long' : 'Short'}</span></Td>
        <Td>{sizeDisplay.text} <span className="text-[10px] text-[#7a8090]">{sizeDisplay.unit}</span></Td>
        <Td>{fmtMarketPrice(position.entryPrice, category)} <span className="text-[10px] text-[#7a8090]">USD</span></Td>
        <Td>{fmtMarketPrice(currentPrice, category)} <span className="text-[10px] text-[#7a8090]">USD</span></Td>
        <Td>{fmt(currentPrice * position.size, 2)} <span className="text-[10px] text-[#7a8090]">USD</span></Td>
        <Td>{fmtMarketPrice(position.liquidationPrice, category)} <span className="text-[10px] text-[#7a8090]">USD</span></Td>
        <Td>{fmt(position.margin, 2)} <span className="text-[10px] text-[#7a8090]">USD</span></Td>
        <Td>
          <span style={{ color: pnlPos ? '#15c990' : '#c026d3' }}>
            {pnlPos ? '+' : ''}{position.pnl.toFixed(2)} USD
          </span>
        </Td>
        <Td>
          <button
            type="button"
            onClick={() => setRiskOpen(true)}
            className="flex flex-col items-start gap-px rounded border border-transparent px-2 py-1 text-left text-[10px] transition-colors hover:border-[#2a2a38] hover:bg-[#1a1820]"
          >
            <span className="flex items-center gap-1">
              <span className="text-[#7a8090]">TP</span>
              <span className={`${position.takeProfit != null ? 'text-[#15c990]' : 'text-[#7a8090]'}`}>{tpDisplay}</span>
              {tpPct != null && <span className="text-[9px] text-[#7a8090]">({tpPct >= 0 ? '+' : ''}{tpPct.toFixed(1)}%)</span>}
              {tpIsPartial && <span className="rounded bg-[#18a7df]/20 px-1 text-[9px] font-semibold uppercase text-[#64d7ff]">partiel</span>}
            </span>
            <span className="flex items-center gap-1">
              <span className="text-[#7a8090]">SL</span>
              <span className={`${position.stopLoss != null ? 'text-[#f43f6e]' : 'text-[#7a8090]'}`}>{slDisplay}</span>
              {slPct != null && <span className="text-[9px] text-[#7a8090]">({slPct.toFixed(1)}%)</span>}
              {slIsPartial && <span className="rounded bg-[#18a7df]/20 px-1 text-[9px] font-semibold uppercase text-[#64d7ff]">partiel</span>}
            </span>
            <span className="mt-px text-[9px] text-[#7a8090]">Cliquer pour modifier</span>
          </button>
        </Td>
        <Td className="text-right">
          <div className="inline-flex items-stretch overflow-hidden rounded border border-[#2a262a]">
            <button
              type="button"
              disabled={busy || !marketOpen}
              onClick={() => onClosePosition(position.id)}
              className="cursor-pointer px-2 py-1 text-[10px] text-[#e0e2ea] hover:bg-[#1a1820] disabled:cursor-not-allowed disabled:opacity-40"
              title={!marketOpen ? 'Marché fermé' : undefined}
            >
              Fermer
            </button>
            <span className="w-px bg-[#2a262a]" />
            <button
              type="button"
              disabled={busy}
              onClick={() => setPanel(panel === 'close' ? 'none' : 'close')}
              className={`cursor-pointer px-1.5 py-1 text-[10px] transition-colors ${panel === 'close' ? 'bg-[#1a1820] text-white' : 'text-[#9498a4] hover:bg-[#1a1820] hover:text-white'}`}
              title="Fermeture partielle"
            >
              ▾
            </button>
          </div>
        </Td>
      </tr>

      {panel === 'close' && (
        <tr className="bg-[#0d0a17]">
          <td colSpan={11} className="px-4 py-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-wide text-[#7a8090]">Fermer maintenant</label>
                <div className="flex items-center gap-1.5">
                  {PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setClosePercent(p)}
                      className={`h-9 cursor-pointer rounded-md border px-3 text-[11px] font-semibold transition-colors ${closePercent === p ? 'border-[#15c990] bg-[#15c990]/15 text-white' : 'border-[#2a262a] text-[#9498a4] hover:border-[#3a3848] hover:text-white'}`}
                    >
                      {p}%
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-wide text-[#7a8090]">% personnalise</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  step="1"
                  value={closePercent}
                  onChange={(event) => {
                    const next = Math.max(1, Math.min(100, Math.round(Number(event.target.value) || 0)));
                    setClosePercent(next);
                  }}
                  className="num h-9 w-24 rounded-md border border-[#2a262a] bg-[#15121f] px-3 text-[13px] font-semibold text-white outline-none focus:border-[#15c990]"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-wide text-[#7a8090]">Quantite</label>
                <div className="flex h-9 items-center gap-1 rounded-md border border-[#2a262a] bg-[#15121f] px-3 text-[12px] text-white">
                  <span className="num font-semibold">{partialSize.toFixed(5)}</span>
                  <span className="text-[10px] text-[#7a8090]">{pairBase(position.pair)}</span>
                  <span className="ml-2 text-[10px] text-[#7a8090]">≈ {fmt(partialUsd, 2)} USD</span>
                </div>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPanel('none')}
                  disabled={busy}
                  className="cursor-pointer rounded-md border border-[#2a262a] px-3 py-2 text-[11px] text-[#9498a4] hover:text-white"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  disabled={busy || !marketOpen || partialSize <= 0}
                  onClick={() => {
                    if (closePercent >= 100) onClosePosition(position.id);
                    else onClosePosition(position.id, partialSize);
                    setPanel('none');
                  }}
                  className="cursor-pointer rounded-md bg-[#f43f6e] px-4 py-2 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {closePercent >= 100 ? 'Fermer 100%' : `Fermer ${closePercent}%`}
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}

      {riskOpen && (
        <RiskModal
          position={position}
          markPrice={currentPrice}
          category={category}
          onClose={() => setRiskOpen(false)}
          onSubmit={async (payload) => {
            await onUpdateRisk(position.id, payload.stopLoss, payload.takeProfit, {
              stopLossSize: payload.stopLossSize,
              takeProfitSize: payload.takeProfitSize,
            });
            setRiskOpen(false);
          }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ RISK MODAL */

interface RiskPayload {
  stopLoss: number | null;
  takeProfit: number | null;
  stopLossSize: number | null;
  takeProfitSize: number | null;
}

function RiskModal({
  position,
  markPrice,
  category,
  onClose,
  onSubmit,
}: {
  position: Position;
  markPrice: number;
  category?: MarketCategory;
  onClose: () => void;
  onSubmit: (payload: RiskPayload) => Promise<void> | void;
}) {
  const isLong = position.side === 'long';
  const sideLabel = isLong ? 'Acheter' : 'Vendre';
  const sideColor = isLong ? '#15c990' : '#f43f6e';
  const sizeSigned = isLong ? position.size : -position.size;
  const isInitiallyPartial =
    (position.takeProfitSize != null && position.takeProfitSize > 0 && position.takeProfitSize < position.size)
    || (position.stopLossSize != null && position.stopLossSize > 0 && position.stopLossSize < position.size);
  const [tab, setTab] = useState<'full' | 'partial'>(isInitiallyPartial ? 'partial' : 'full');
  const defaultPartialQty = Math.max(position.size * 0.5, 0);
  const initialTpQty = position.takeProfitSize != null && position.takeProfitSize > 0 && position.takeProfitSize < position.size
    ? position.takeProfitSize
    : defaultPartialQty;
  const initialSlQty = position.stopLossSize != null && position.stopLossSize > 0 && position.stopLossSize < position.size
    ? position.stopLossSize
    : defaultPartialQty;

  const [tpPriceDraft, setTpPriceDraft] = useState<string>(position.takeProfit != null ? String(position.takeProfit) : '');
  const [tpPctDraft, setTpPctDraft] = useState<string>(() => {
    if (position.takeProfit == null || !Number.isFinite(position.entryPrice) || position.entryPrice <= 0) return '';
    const raw = ((position.takeProfit - position.entryPrice) / position.entryPrice) * 100;
    return (isLong ? raw : -raw).toFixed(2);
  });
  const [tpQtyDraft, setTpQtyDraft] = useState<string>(initialTpQty.toFixed(5));

  const [slPriceDraft, setSlPriceDraft] = useState<string>(position.stopLoss != null ? String(position.stopLoss) : '');
  const [slPctDraft, setSlPctDraft] = useState<string>(() => {
    if (position.stopLoss == null || !Number.isFinite(position.entryPrice) || position.entryPrice <= 0) return '';
    const raw = ((position.stopLoss - position.entryPrice) / position.entryPrice) * 100;
    return (isLong ? raw : -raw).toFixed(2);
  });
  const [slQtyDraft, setSlQtyDraft] = useState<string>(initialSlQty.toFixed(5));

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>('');

  function pctToPrice(pct: number, kind: 'tp' | 'sl'): number {
    const dir = kind === 'tp' ? 1 : -1;
    return position.entryPrice * (1 + (isLong ? dir : -dir) * pct / 100);
  }
  function priceToPct(price: number, kind: 'tp' | 'sl'): number {
    const raw = ((price - position.entryPrice) / position.entryPrice) * 100;
    const signed = isLong ? raw : -raw;
    return kind === 'tp' ? signed : -signed;
  }

  function setTpFromPrice(value: string) {
    setTpPriceDraft(value);
    const num = Number(value);
    if (value === '' || !Number.isFinite(num)) {
      setTpPctDraft('');
    } else {
      setTpPctDraft(priceToPct(num, 'tp').toFixed(2));
    }
  }
  function setTpFromPct(value: string) {
    setTpPctDraft(value);
    const num = Number(value);
    if (value === '' || !Number.isFinite(num)) {
      setTpPriceDraft('');
    } else {
      setTpPriceDraft(priceToInputString(pctToPrice(num, 'tp'), category));
    }
  }
  function setSlFromPrice(value: string) {
    setSlPriceDraft(value);
    const num = Number(value);
    if (value === '' || !Number.isFinite(num)) {
      setSlPctDraft('');
    } else {
      setSlPctDraft(priceToPct(num, 'sl').toFixed(2));
    }
  }
  function setSlFromPct(value: string) {
    setSlPctDraft(value);
    const num = Number(value);
    if (value === '' || !Number.isFinite(num)) {
      setSlPriceDraft('');
    } else {
      setSlPriceDraft(priceToInputString(pctToPrice(num, 'sl'), category));
    }
  }

  const tpEstimateUsd = (() => {
    const price = Number(tpPriceDraft);
    const qty = tab === 'partial' ? Math.min(position.size, Math.max(0, Number(tpQtyDraft) || 0)) : position.size;
    if (!Number.isFinite(price) || price <= 0 || qty <= 0) return null;
    const dirty = isLong ? (price - position.entryPrice) : (position.entryPrice - price);
    return dirty * qty;
  })();
  const slEstimateUsd = (() => {
    const price = Number(slPriceDraft);
    const qty = tab === 'partial' ? Math.min(position.size, Math.max(0, Number(slQtyDraft) || 0)) : position.size;
    if (!Number.isFinite(price) || price <= 0 || qty <= 0) return null;
    const dirty = isLong ? (price - position.entryPrice) : (position.entryPrice - price);
    return dirty * qty;
  })();

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      const tpPrice = tpPriceDraft.trim() === '' ? null : Number(tpPriceDraft);
      const slPrice = slPriceDraft.trim() === '' ? null : Number(slPriceDraft);
      if (tpPrice != null && (!Number.isFinite(tpPrice) || tpPrice <= 0)) throw new Error('Take profit invalide');
      if (slPrice != null && (!Number.isFinite(slPrice) || slPrice <= 0)) throw new Error('Stop loss invalide');

      // Validate against the LIVE mark price (not the entry price): a SL/TP
      // can be placed anywhere as long as it would not trigger immediately.
      // This lets the user move the SL into profit on a winning trade.
      const ref = Number.isFinite(markPrice) && markPrice > 0 ? markPrice : position.entryPrice;
      if (slPrice != null && !isValidStopLoss(position.side, ref, slPrice)) {
        throw new Error(
          position.side === 'long'
            ? 'Le stop loss doit etre sous le prix actuel'
            : 'Le stop loss doit etre au-dessus du prix actuel',
        );
      }
      if (tpPrice != null && !isValidTakeProfit(position.side, ref, tpPrice)) {
        throw new Error(
          position.side === 'long'
            ? 'Le take profit doit etre au-dessus du prix actuel'
            : 'Le take profit doit etre sous le prix actuel',
        );
      }

      let tpSize: number | null = null;
      let slSize: number | null = null;
      if (tab === 'partial') {
        const tpQ = tpQtyDraft.trim() === '' ? null : Number(tpQtyDraft);
        const slQ = slQtyDraft.trim() === '' ? null : Number(slQtyDraft);
        if (tpPrice != null && (tpQ == null || !Number.isFinite(tpQ) || tpQ <= 0)) throw new Error('Quantite TP invalide');
        if (slPrice != null && (slQ == null || !Number.isFinite(slQ) || slQ <= 0)) throw new Error('Quantite SL invalide');
        if (tpQ != null && tpQ >= position.size - 1e-9) throw new Error('Pour un TP partiel, la quantite doit etre inferieure a la taille totale');
        if (slQ != null && slQ >= position.size - 1e-9) throw new Error('Pour un SL partiel, la quantite doit etre inferieure a la taille totale');
        tpSize = tpQ ?? null;
        slSize = slQ ?? null;
      }

      await onSubmit({
        stopLoss: slPrice,
        takeProfit: tpPrice,
        stopLossSize: slSize,
        takeProfitSize: tpSize,
      });
    } catch (err: any) {
      setError(err?.message || 'Erreur SL/TP');
    } finally {
      setBusy(false);
    }
  }

  function clearAll() {
    setTpPriceDraft('');
    setTpPctDraft('');
    setSlPriceDraft('');
    setSlPctDraft('');
  }

  let liquidationDisplay: number | null = position.liquidationPrice ?? null;
  if (liquidationDisplay == null && position.leverage > 0 && Number.isFinite(position.entryPrice)) {
    liquidationDisplay = isLong
      ? position.entryPrice * (1 - 1 / position.leverage)
      : position.entryPrice * (1 + 1 / position.leverage);
  }
  const liquidationLabel = liquidationDisplay != null && Number.isFinite(liquidationDisplay)
    ? fmtMarketPrice(liquidationDisplay, category)
    : '—';

  return createPortal(
    (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6"
          role="dialog"
          aria-modal="true"
          onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}
        >
          <div className="w-full max-w-[640px] overflow-hidden rounded-2xl border border-[#1c1928] bg-[#100d1a] shadow-2xl shadow-black/60">
            <div className="flex items-center justify-between border-b border-[#1c1928] px-6 py-4">
              <h3 className="text-[18px] font-semibold text-white">Take profit / Stop loss</h3>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="cursor-pointer rounded-md border border-transparent p-1 text-[#9498a4] hover:border-[#2a262a] hover:text-white"
              >
                <Icon d={ICONS.close} size={16} />
              </button>
            </div>

            <div className="px-6 pt-4">
              <div className="rounded-xl border border-[#1c1928] bg-[#13101e] px-4 py-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-[13px]">
                      <span style={{ color: sideColor }} className="font-semibold">{sideLabel}</span>
                      <span className="ml-2 num text-white">{sizeSigned > 0 ? '+' : ''}{sizeSigned.toFixed(4)} {pairBase(position.pair)} Perp</span>
                    </div>
                    <div className="mt-1 text-[12px] text-[#9498a4]">Levier <span className="num text-white">x{position.leverage}</span></div>
                  </div>
                  <span className="rounded-md bg-[#1c1928] px-2 py-1 text-[10px] uppercase tracking-wide text-[#9498a4]">Position</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                  <div className="min-w-0 rounded-lg border border-[#1c1928] bg-[#0f0c19] px-2.5 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-[#7a8090]">Entree</div>
                    <div
                      className="num mt-0.5 truncate text-[12px] font-semibold tabular-nums text-white"
                      title={fmtMarketPrice(position.entryPrice, category)}
                    >
                      {fmtMarketPrice(position.entryPrice, category)}
                    </div>
                  </div>
                  <div className="min-w-0 rounded-lg border border-[#1c1928] bg-[#0f0c19] px-2.5 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-[#7a8090]">Marche</div>
                    <div
                      className="num mt-0.5 truncate text-[12px] font-semibold tabular-nums text-white"
                      title={fmtMarketPrice(markPrice, category)}
                    >
                      {fmtMarketPrice(markPrice, category)}
                    </div>
                  </div>
                  <div className="min-w-0 rounded-lg border border-[#f43f6e]/30 bg-[#f43f6e]/5 px-2.5 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-[#f43f6e]">Liquidation</div>
                    <div
                      className="num mt-0.5 truncate text-[12px] font-semibold tabular-nums text-white"
                      title={liquidationLabel !== '—' ? liquidationLabel : undefined}
                    >
                      {liquidationLabel}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 pt-4">
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-[#13101e] p-1">
                <button
                  type="button"
                  onClick={() => setTab('full')}
                  className={`h-10 cursor-pointer rounded-lg text-[12px] font-semibold transition-colors ${tab === 'full' ? 'bg-[#1f1a2b] text-white' : 'text-[#9498a4] hover:text-white'}`}
                >
                  Integralite de la position
                </button>
                <button
                  type="button"
                  onClick={() => setTab('partial')}
                  className={`h-10 cursor-pointer rounded-lg text-[12px] font-semibold transition-colors ${tab === 'partial' ? 'bg-[#1f1a2b] text-white' : 'text-[#9498a4] hover:text-white'}`}
                >
                  Sortie partielle
                </button>
              </div>
            </div>

            <div className="space-y-4 px-6 py-5">
              <div className="rounded-xl border border-[#1c1928] bg-[#13101e] px-4 py-4">
                <div className="flex items-center justify-between">
                  <div className="text-[13px] font-semibold text-white">Take profit</div>
                  {tpEstimateUsd != null && (
                    <span className="text-[11px] font-semibold" style={{ color: tpEstimateUsd >= 0 ? '#15c990' : '#f43f6e' }}>
                      {tpEstimateUsd >= 0 ? '+' : ''}{tpEstimateUsd.toFixed(2)} USD
                    </span>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-[11px] text-[#7a8090]">Declencheur</span>
                    <div className="mt-1 flex h-11 items-center gap-1 rounded-lg border border-[#2a262a] bg-[#15121f] px-3 focus-within:border-[#15c990]">
                      <input
                        type="number"
                        step="0.01"
                        value={tpPriceDraft}
                        onChange={(event) => setTpFromPrice(event.target.value)}
                        placeholder="-"
                        className="num h-full w-full bg-transparent text-[14px] font-semibold text-white outline-none"
                      />
                      <span className="text-[11px] text-[#7a8090]">USD</span>
                    </div>
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-[#7a8090]">Distance d'entree</span>
                    <div className="mt-1 flex h-11 items-center gap-1 rounded-lg border border-[#2a262a] bg-[#15121f] px-3 focus-within:border-[#15c990]">
                      <input
                        type="number"
                        step="0.01"
                        value={tpPctDraft}
                        onChange={(event) => setTpFromPct(event.target.value)}
                        placeholder="-"
                        className="num h-full w-full bg-transparent text-[14px] font-semibold text-white outline-none"
                      />
                      <span className="text-[11px] text-[#7a8090]">%</span>
                    </div>
                  </label>
                </div>
                {tab === 'partial' && (
                  <label className="mt-3 block">
                    <span className="text-[11px] text-[#7a8090]">Quantite a fermer au TP</span>
                    <div className="mt-1 flex h-11 items-center gap-2 rounded-lg border border-[#2a262a] bg-[#15121f] px-3 focus-within:border-[#15c990]">
                      <input
                        type="number"
                        step="0.00001"
                        min={0}
                        max={position.size}
                        value={tpQtyDraft}
                        onChange={(event) => setTpQtyDraft(event.target.value)}
                        className="num h-full w-full bg-transparent text-[14px] font-semibold text-white outline-none"
                      />
                      <span className="text-[11px] text-[#7a8090]">{pairBase(position.pair)}</span>
                      <span className="ml-auto text-[10px] text-[#7a8090]">/ {position.size.toFixed(5)}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      {[25, 50, 75].map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setTpQtyDraft((position.size * p / 100).toFixed(5))}
                          className="cursor-pointer rounded border border-[#2a262a] px-2 py-1 text-[10px] text-[#9498a4] hover:border-[#3a3848] hover:text-white"
                        >
                          {p}%
                        </button>
                      ))}
                    </div>
                  </label>
                )}
              </div>

              <div className="rounded-xl border border-[#1c1928] bg-[#13101e] px-4 py-4">
                <div className="flex items-center justify-between">
                  <div className="text-[13px] font-semibold text-white">Stop loss</div>
                  {slEstimateUsd != null && (
                    <span className="text-[11px] font-semibold" style={{ color: slEstimateUsd >= 0 ? '#15c990' : '#f43f6e' }}>
                      {slEstimateUsd >= 0 ? '+' : ''}{slEstimateUsd.toFixed(2)} USD
                    </span>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-[11px] text-[#7a8090]">Declencheur</span>
                    <div className="mt-1 flex h-11 items-center gap-1 rounded-lg border border-[#2a262a] bg-[#15121f] px-3 focus-within:border-[#f43f6e]">
                      <input
                        type="number"
                        step="0.01"
                        value={slPriceDraft}
                        onChange={(event) => setSlFromPrice(event.target.value)}
                        placeholder="-"
                        className="num h-full w-full bg-transparent text-[14px] font-semibold text-white outline-none"
                      />
                      <span className="text-[11px] text-[#7a8090]">USD</span>
                    </div>
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-[#7a8090]">Distance d'entree</span>
                    <div className="mt-1 flex h-11 items-center gap-1 rounded-lg border border-[#2a262a] bg-[#15121f] px-3 focus-within:border-[#f43f6e]">
                      <input
                        type="number"
                        step="0.01"
                        value={slPctDraft}
                        onChange={(event) => setSlFromPct(event.target.value)}
                        placeholder="-"
                        className="num h-full w-full bg-transparent text-[14px] font-semibold text-white outline-none"
                      />
                      <span className="text-[11px] text-[#7a8090]">%</span>
                    </div>
                  </label>
                </div>
                {tab === 'partial' && (
                  <label className="mt-3 block">
                    <span className="text-[11px] text-[#7a8090]">Quantite a fermer au SL</span>
                    <div className="mt-1 flex h-11 items-center gap-2 rounded-lg border border-[#2a262a] bg-[#15121f] px-3 focus-within:border-[#f43f6e]">
                      <input
                        type="number"
                        step="0.00001"
                        min={0}
                        max={position.size}
                        value={slQtyDraft}
                        onChange={(event) => setSlQtyDraft(event.target.value)}
                        className="num h-full w-full bg-transparent text-[14px] font-semibold text-white outline-none"
                      />
                      <span className="text-[11px] text-[#7a8090]">{pairBase(position.pair)}</span>
                      <span className="ml-auto text-[10px] text-[#7a8090]">/ {position.size.toFixed(5)}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      {[25, 50, 75].map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setSlQtyDraft((position.size * p / 100).toFixed(5))}
                          className="cursor-pointer rounded border border-[#2a262a] px-2 py-1 text-[10px] text-[#9498a4] hover:border-[#3a3848] hover:text-white"
                        >
                          {p}%
                        </button>
                      ))}
                    </div>
                  </label>
                )}
              </div>

              {error && <div className="rounded-md border border-[#f43f6e]/40 bg-[#f43f6e]/10 px-3 py-2 text-[12px] text-[#ff8ab9]">{error}</div>}
            </div>

            <div className="flex items-center gap-3 border-t border-[#1c1928] px-6 py-4">
              <button
                type="button"
                onClick={clearAll}
                disabled={busy}
                className="cursor-pointer text-[11px] uppercase tracking-wide text-[#7a8090] hover:text-white"
              >
                Tout effacer
              </button>
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  className="h-11 cursor-pointer rounded-lg border border-[#2a262a] bg-transparent px-5 text-[13px] font-semibold text-[#e0e2ea] transition-colors hover:border-[#3a3848] hover:text-white"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={confirm}
                  disabled={busy}
                  className="h-11 cursor-pointer rounded-lg bg-[#15c990] px-6 text-[13px] font-semibold text-[#0e0c0d] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? '...' : 'Confirmer'}
                </button>
              </div>
            </div>
          </div>
        </div>
    ),
    document.body,
  );
}

/* ------------------------------------------------------------------ BOTTOM TABS */

function BottomTabs({
  tab,
  setTab,
  height,
  expanded,
  mobileMode = false,
  onResizeStart,
  onResizeMove,
  onResizeEnd,
  onToggleExpanded,
  player,
  recentTrades,
  ticker,
  onClosePosition,
  onUpdateRisk,
  onCancelOrder,
  onSelectPair,
  busy,
  marketMetadata,
}: {
  tab: 'positions' | 'ordres' | 'historique';
  setTab: (tab: 'positions' | 'ordres' | 'historique') => void;
  height: number;
  expanded: boolean;
  mobileMode?: boolean;
  onResizeStart: (event: PointerEvent<HTMLDivElement>) => void;
  onResizeMove: (event: PointerEvent<HTMLDivElement>) => void;
  onResizeEnd: (event: PointerEvent<HTMLDivElement>) => void;
  onToggleExpanded: () => void;
  player: Player | null;
  recentTrades: Player['trades'];
  ticker: MarketTicker | undefined;
  onClosePosition: (positionId: string, partialSize?: number) => void;
  onUpdateRisk: (
    positionId: string,
    stopLoss: number | null,
    takeProfit: number | null,
    options?: { stopLossSize?: number | null; takeProfitSize?: number | null },
  ) => Promise<void> | void;
  onCancelOrder: (orderId: string) => void;
  onSelectPair: (pair: string) => void;
  busy: boolean;
  marketMetadata: Record<string, MarketMetadata>;
}) {
  const positions = player?.openPositions ?? [];
  const orders = player?.openOrders ?? [];
  const allTrades = recentTrades;

  const tabs = [
    { id: 'positions' as const, label: 'Positions', count: positions.length || undefined },
    { id: 'ordres' as const, label: 'Ordres', count: orders.length || undefined },
    { id: 'historique' as const, label: 'Historique', count: allTrades.length || undefined },
  ];

  return (
    <section
      className={`flex min-h-0 flex-col rounded-2xl border border-[#2a2236] bg-[#10091c] ${
        mobileMode
          ? 'shrink-0 overflow-visible'
          : `overflow-hidden ${expanded ? 'flex-1' : 'shrink-0'}`
      }`}
      style={mobileMode || expanded ? undefined : { height }}
    >
      {!expanded && !mobileMode && (
        <div
          role="separator"
          aria-orientation="horizontal"
          title="Tirer pour agrandir ou réduire"
          onPointerDown={onResizeStart}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onPointerCancel={onResizeEnd}
          className="group flex h-3 shrink-0 cursor-row-resize items-center justify-center border-b border-[#171321] bg-[#0c0815] hover:bg-[#15101f]"
        >
          <span className="h-1 w-12 rounded-full bg-[#342b46] transition-colors group-hover:bg-[#dc2626]/70" />
        </div>
      )}
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-[#171321] px-2 text-[11px] text-[#7f778d]">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-3 transition-colors ${tab === item.id ? 'bg-[#201a2b] text-white' : 'hover:bg-[#15121f] hover:text-[#e0e2ea]'}`}
          >
            <span>{item.label}</span>
            {item.count != null && (
              <span className="rounded bg-[#2a2335] px-1 py-px text-[9px] text-[#9498a4]">{item.count}</span>
            )}
          </button>
        ))}
        <span className="ml-auto hidden items-center gap-2 text-[#7a8090] lg:flex">
          <button
            type="button"
            onClick={onToggleExpanded}
            title={expanded ? 'Réduire la section' : 'Agrandir la section'}
            className="cursor-pointer rounded-md p-1 hover:bg-[#201a2b] hover:text-[#e0e2ea]"
          >
            <Icon d={expanded ? ICONS.close : ICONS.expand} size={13} />
          </button>
        </span>
      </div>

      <div className={mobileMode ? 'overflow-x-auto' : 'flex-1 overflow-auto'}>
        {tab === 'positions' && (
          positions.length === 0 ? (
            <EmptyState lines={['Aucune position. Commencez à trader avec un effet de levier ↗']} />
          ) : (
            <table className="w-full text-left text-[11.5px]">
              <thead className="text-[10px] uppercase tracking-[0.05em] text-[#7a8090]">
                <tr className="border-b border-[#231f22]">
                  <Th>Marché</Th>
                  <Th>Prix</Th>
                  <Th>Quantité ouverte</Th>
                  <Th>Prix de l'ouverture</Th>
                  <Th>Prix actuel</Th>
                  <Th>Valeur</Th>
                  <Th>Estimation du prix de liquidation</Th>
                  <Th>Marge initiale</Th>
                  <Th>Gains et pertes non réalisés</Th>
                  <Th>TP / SL</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1c181a] text-[#e0e2ea]">
                {positions.map((position) => (
                  <PositionRow
                    key={position.id}
                    position={position}
                    category={marketMetadata[position.pair]?.category}
                    ticker={ticker}
                    busy={busy}
                    onClosePosition={onClosePosition}
                    onUpdateRisk={onUpdateRisk}
                    onSelectPair={onSelectPair}
                  />
                ))}
              </tbody>
            </table>
          )
        )}

        {tab === 'ordres' && (
          orders.length === 0 ? (
            <EmptyState lines={['Aucun ordre ouvert.']} />
          ) : (
            <table className="w-full text-left text-[11.5px]">
              <thead className="text-[10px] uppercase tracking-[0.05em] text-[#7a8090]">
                <tr className="border-b border-[#231f22]">
                  <Th>Marché</Th><Th>Side</Th><Th>Type</Th><Th>Prix limite</Th>
                  <Th>Quantité</Th><Th>Levier</Th><Th>Réservé</Th><Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1c181a] text-[#e0e2ea]">
                {orders.map((order) => {
                  const orderSizeDisplay = formatEngineSizeDisplay(order.pair, order.size, pairBase(order.pair));
                  return (
                  <tr key={order.id} className="hover:bg-[#181517]">
                    <Td>
                      <button
                        type="button"
                        onClick={() => onSelectPair(order.pair)}
                        className="cursor-pointer rounded px-1 py-0.5 -mx-1 text-left text-white transition-colors hover:bg-[#1f1b27]"
                        title={`Afficher ${order.pair} sur le graphique`}
                      >
                        {order.pair}
                      </button>
                    </Td>
                    <Td><span style={{ color: order.side === 'long' ? '#15c990' : '#c026d3' }}>{order.side === 'long' ? 'Long' : 'Short'}</span></Td>
                    <Td className="capitalize">{order.orderType === 'market' ? 'Marché' : 'Limite'}</Td>
                    <Td>{order.limitPrice ? fmtMarketPrice(order.limitPrice, marketMetadata[order.pair]?.category) : '–'}</Td>
                    <Td>{orderSizeDisplay.text} <span className="text-[10px] text-[#7a8090]">{orderSizeDisplay.unit}</span></Td>
                    <Td>{order.leverage}x</Td>
                    <Td>{fmt(order.marginReserved + order.feeEstimate, 2)} USD</Td>
                    <Td className="text-right">
                      <button type="button" disabled={busy} onClick={() => onCancelOrder(order.id)} className="cursor-pointer rounded border border-[#2a262a] px-2 py-1 text-[10px] text-[#e0e2ea] hover:border-[#2a2a38]">
                        Annuler
                      </button>
                    </Td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}

        {tab === 'historique' && (
          allTrades.length === 0 ? (
            <EmptyState lines={['Aucun trade pour l\u2019instant.']} />
          ) : (
            <table className="w-full text-left text-[11.5px]">
              <thead className="text-[10px] uppercase tracking-[0.05em] text-[#7a8090]">
                <tr className="border-b border-[#231f22]">
                  <Th>Heure</Th><Th>Marché</Th><Th>Side</Th><Th>Action</Th>
                  <Th>Prix</Th><Th>Quantité</Th><Th>Frais</Th><Th>PnL</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1c181a] text-[#e0e2ea]">
                {allTrades.map((trade) => (
                  <tr key={trade.id} className="hover:bg-[#181517]">
                    <Td className="text-[#9498a4]">{timeAgo(trade.time)}</Td>
                    <Td>
                      <button
                        type="button"
                        onClick={() => onSelectPair(trade.pair)}
                        className="cursor-pointer rounded px-1 py-0.5 -mx-1 text-left text-white transition-colors hover:bg-[#1f1b27]"
                        title={`Afficher ${trade.pair} sur le graphique`}
                      >
                        {trade.pair}
                      </button>
                    </Td>
                    <Td><span style={{ color: trade.side === 'long' ? '#15c990' : '#c026d3' }}>{trade.side === 'long' ? 'Long' : 'Short'}</span></Td>
                    <Td className="capitalize">{trade.action}</Td>
                    <Td>{fmt(trade.price, 1)}</Td>
                    <Td>{trade.size.toFixed(5)}</Td>
                    <Td>{fmt(trade.fee, 4)}</Td>
                    <Td><span style={{ color: trade.pnl >= 0 ? '#15c990' : '#c026d3' }}>{formatPnl(trade.pnl)}</span></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </section>
  );
}

function EmptyState({ lines }: { lines: string[] }) {
  return (
    <div className="flex h-full items-center justify-center text-center text-[12px] text-[#7a8090]">
      {lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  );
}

function CompetitionLeaderboardPanel({
  data,
  currentUserId,
  currentName,
  error,
}: {
  data: LeaderboardResponse | null;
  currentUserId?: string | null;
  currentName?: string;
  error?: string;
}) {
  const rows = data?.leaderboard ?? [];
  const myRow = rows.find((row) => (
    currentUserId ? row.userId === currentUserId : currentName ? row.name === currentName : false
  )) || null;
  const visibleRows = useMemo(() => {
    if (!rows.length) return [];
    if (!myRow) return rows.slice(0, 20);
    const index = rows.findIndex((row) => row.userId === myRow.userId);
    const start = Math.max(0, Math.min(index - 4, rows.length - 9));
    return rows.slice(start, start + 9);
  }, [myRow, rows]);

  if (error) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center rounded-2xl border border-[#2a2236] bg-[#10091c] p-5 text-center text-[12px] text-[#fca5a5]">
        {error}
      </section>
    );
  }

  if (!data) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center rounded-2xl border border-[#2a2236] bg-[#10091c] p-5 text-center text-[12px] text-[#7a8090]">
        Chargement du leaderboard...
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#2a2236] bg-[#10091c]">
      <div className="shrink-0 border-b border-[#171321] px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#dc2626]">Leaderboard</div>
            <div className="truncate text-[14px] font-bold text-white">{data.competition.title}</div>
          </div>
          <a
            href={`/compete/leaderboard/${data.competition.id}`}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-xl border border-[#dc2626]/35 bg-[#dc2626]/15 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-white"
          >
            Ouvrir
          </a>
        </div>
        {myRow && (
          <div className="mt-3 rounded-xl border border-[#dc2626]/35 bg-[#dc2626]/12 px-3 py-2">
            <div className="text-[9px] uppercase tracking-[0.16em] text-[#fca5a5]">Ta position</div>
            <LeaderboardMiniRow row={myRow} isMe compact />
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {visibleRows.length === 0 ? (
          <EmptyState lines={['Aucun participant dans le classement.']} />
        ) : (
          <div className="divide-y divide-[#171321]">
            {visibleRows.map((row) => (
              <LeaderboardMiniRow key={row.userId} row={row} isMe={myRow?.userId === row.userId} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Leaderboard latéral du terminal Live (BTF event).
 *
 * Consomme directement le store global (`useGameStore.players`) qui contient
 * uniquement les joueurs roster Live actifs (les traders compétition online
 * sont retirés via `onlineCompetitionPlayerIds` côté serveur). Trie par
 * pnlPercent desc et met en évidence le trader courant.
 */
function LiveRosterLeaderboardPanel({
  players,
  currentPlayerId,
}: {
  players: Player[];
  currentPlayerId: string | null;
}) {
  const ranked = useMemo(() => {
    return [...players]
      .filter((p) => p.active !== false)
      .sort((a, b) => (b.pnlPercent ?? 0) - (a.pnlPercent ?? 0))
      .slice(0, 50);
  }, [players]);

  const myIndex = ranked.findIndex((p) => p.id === currentPlayerId);
  const visible = useMemo(() => {
    if (!ranked.length) return [];
    if (myIndex < 0) return ranked.slice(0, 20);
    const start = Math.max(0, Math.min(myIndex - 4, ranked.length - 9));
    return ranked.slice(start, start + 9);
  }, [myIndex, ranked]);
  const myPlayer = myIndex >= 0 ? ranked[myIndex] : null;

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#2a2236] bg-[#10091c]">
      <div className="shrink-0 border-b border-[#171321] px-3 py-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#dc2626]">Leaderboard</div>
          <div className="truncate text-[14px] font-bold text-white">BTF Live event</div>
        </div>
        {myPlayer && (
          <div className="mt-3 rounded-xl border border-[#dc2626]/35 bg-[#dc2626]/12 px-3 py-2">
            <div className="text-[9px] uppercase tracking-[0.16em] text-[#fca5a5]">Ta position</div>
            <LiveRosterRow player={myPlayer} rank={myIndex + 1} isMe compact />
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <EmptyState lines={['Aucun trader actif dans le roster.']} />
        ) : (
          <div className="divide-y divide-[#171321]">
            {visible.map((player) => {
              const rank = ranked.findIndex((p) => p.id === player.id) + 1;
              return (
                <LiveRosterRow
                  key={player.id}
                  player={player}
                  rank={rank}
                  isMe={player.id === currentPlayerId}
                />
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function LiveRosterRow({
  player,
  rank,
  isMe,
  compact = false,
}: {
  player: Player;
  rank: number;
  isMe?: boolean;
  compact?: boolean;
}) {
  const positive = (player.pnlPercent ?? 0) >= 0;
  return (
    <div className={`grid grid-cols-[42px_minmax(0,1fr)_74px_62px] items-center gap-2 px-3 ${compact ? 'py-1.5' : 'py-3'} text-[12px] ${isMe ? 'bg-[#dc2626]/10' : ''}`}>
      <div className={`num font-bold ${isMe ? 'text-white' : 'text-[#8f899e]'}`}>#{rank}</div>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          {player.avatar ? (
            <AvatarImage src={player.avatar} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" sizePx={20} />
          ) : (
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold uppercase text-white"
              style={{ background: player.color || '#dc2626' }}
            >
              {player.name.slice(0, 2)}
            </span>
          )}
          <span className="truncate font-bold text-white">{player.name}</span>
        </div>
        {!compact && (
          <div className="text-[10px] text-[#6f687f]">{player.tradeCount ?? 0} trades</div>
        )}
      </div>
      <div className={`num text-right font-bold ${positive ? 'text-[#15c990]' : 'text-[#f43f6e]'}`}>
        {fmtSigned(player.pnlPercent ?? 0, 2)}%
      </div>
      <div className={`num text-right font-bold ${positive ? 'text-[#15c990]' : 'text-[#f43f6e]'}`}>
        {fmtSigned(player.pnl ?? 0, 0)}
      </div>
    </div>
  );
}

function LeaderboardMiniRow({ row, isMe, compact = false }: { row: LeaderboardRow; isMe?: boolean; compact?: boolean }) {
  const positive = row.pnlPercent >= 0;
  return (
    <div className={`grid grid-cols-[42px_minmax(0,1fr)_74px_62px] items-center gap-2 px-3 ${compact ? 'py-1.5' : 'py-3'} text-[12px] ${isMe ? 'bg-[#dc2626]/10' : ''}`}>
      <div className={`num font-bold ${isMe ? 'text-white' : 'text-[#8f899e]'}`}>#{row.rank}</div>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          {row.avatarUrl ? (
            <AvatarImage src={row.avatarUrl} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" sizePx={20} />
          ) : (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#dc2626] to-[#7f1d1d] text-[8px] font-bold uppercase text-white">
              {row.name.slice(0, 2)}
            </span>
          )}
          <span className="truncate font-bold text-white">{row.name}</span>
          {isMe && (
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#dc2626]/45 bg-[#dc2626]/18 text-[#fca5a5]" title="Ton classement" aria-label="Ton classement">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21a8 8 0 0 0-16 0" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </span>
          )}
        </div>
        {!compact && <div className="text-[10px] text-[#6f687f]">{row.tradesCount} trades</div>}
      </div>
      <div className={`num text-right font-bold ${positive ? 'text-[#15c990]' : 'text-[#f43f6e]'}`}>
        {fmtSigned(row.pnlPercent, 2)}%
      </div>
      <div className={`num truncate text-right text-[11px] ${positive ? 'text-[#86efac]' : 'text-[#fca5a5]'}`}>
        {fmtSigned(row.pnlUsd, 2)}$
      </div>
    </div>
  );
}

function Th({ children }: { children?: ReactNode }) {
  return <th className="label px-3 py-[7px] text-[10px] font-medium">{children}</th>;
}

function Td({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <td className={`px-3 py-[7px] ${className}`}>{children}</td>;
}

/* ------------------------------------------------------------------ COMPETITION BANNER */

function formatCountdown(target: number): string {
  const delta = target - Date.now();
  if (delta <= 0) return '00:00:00';
  const totalSec = Math.floor(delta / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function CompetitionBanner({ ctx }: { ctx: { id: string; title: string; mode: 'paper' | 'real'; startAt?: number; endAt?: number; status?: 'upcoming' | 'live' | 'ended'; rank?: number | null; participants?: number; pnlPercent?: number } }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const isLive = ctx.status === 'live';
  const isUpcoming = ctx.status === 'upcoming';
  const isEnded = ctx.status === 'ended';
  const target = isLive ? ctx.endAt : ctx.startAt;
  const countdown = target ? formatCountdown(target) : null;
  const countdownLabel = isLive ? 'FIN DANS' : isUpcoming ? 'DEMARRE DANS' : 'STATUS';
  const hasLeaderboard = ctx.id && ctx.id !== 'unknown';
  const rankLabel = ctx.rank ? `#${ctx.rank}` : '–';
  const participants = ctx.participants ?? null;
  const pnl = ctx.pnlPercent ?? null;
  const pnlPos = (pnl ?? 0) >= 0;

  return (
    <div className="mx-3 mt-3 flex flex-wrap items-center gap-2.5 rounded-lg border border-[#dc2626]/30 bg-gradient-to-r from-[#1a0a0a] to-[#120608] px-3 py-2 text-[12px] text-[#fca5a5]">
      <span className="flex items-center gap-1.5 rounded-full border border-[#dc2626]/35 bg-[#dc2626]/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#fca5a5]">
        {isLive && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ef4444] shadow-[0_0_6px_rgba(239,68,68,0.9)]" />}
        {isLive ? 'Live' : isUpcoming ? 'A venir' : isEnded ? 'Terminee' : 'Compete'}
      </span>

      <div className="min-w-0 flex-shrink">
        <div className="truncate text-[13px] font-semibold text-white">{ctx.title}</div>
      </div>

      <span className="hidden h-4 w-px bg-[#dc2626]/25 md:inline-block" />

      {countdown && !isEnded && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#71717a]">{countdownLabel}</span>
          <span className="num rounded-md border border-[#dc2626]/30 bg-black/30 px-2 py-1 text-[13px] font-bold text-white">{countdown}</span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#71717a]">Rank</span>
        <span className="flex items-center gap-1.5 rounded-md border border-[#dc2626]/25 bg-black/30 px-2 py-1">
          <span className="num text-[13px] font-bold text-white">{rankLabel}</span>
          {participants !== null && <span className="text-[10.5px] text-[#71717a]">/ {participants}</span>}
        </span>
      </div>

      {pnl !== null && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#71717a]">PNL</span>
          <span className={`num text-[12.5px] font-semibold ${pnlPos ? 'text-[#10b981]' : 'text-[#ef4444]'}`}>
            {pnlPos ? '+' : ''}{pnl.toFixed(2)}%
          </span>
        </div>
      )}

      {hasLeaderboard && (
        <a
          href={`/compete/leaderboard/${ctx.id}`}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-[#dc2626]/40 bg-[#dc2626]/15 px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-white transition-colors hover:border-[#ef4444] hover:bg-[#dc2626]/25"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3h7v9H3z" />
            <path d="M14 3h7v6h-7z" />
            <path d="M14 12h7v9h-7z" />
            <path d="M3 16h7v5H3z" />
          </svg>
          Leaderboard
        </a>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ MAIN */

export default function ExchangeTerminal({ demoMode = false }: ExchangeTerminalProps) {
  const location = useLocation();
  const terminalPlatform = useMemo<TerminalPlatform>(
    () => (demoMode ? 'compete' : getTerminalPlatformFromUrl(location.search)),
    [demoMode, location.search],
  );
  const urlCompetitionId = useMemo(
    () => (demoMode ? null : getCompetitionIdFromUrl(location.search)),
    [demoMode, location.search],
  );

  const players = useGameStore((state) => state.players);
  const recentTrades = useGameStore((state) => state.recentTrades);
  const eventStarted = useGameStore((state) => state.eventStarted);
  const eventStartTime = useGameStore((state) => state.eventStartTime);
  const platformMode = useGameStore((state) => state.platformMode);
  const paperStartingBalance = useGameStore((state) => state.paperStartingBalance);
  const wsMarket = useGameStore((state) => state.market);
  const [introCountdownDone, setIntroCountdownDone] = useState(false);

  useEffect(() => {
    if (!eventStarted || eventStartTime == null) {
      setIntroCountdownDone(false);
      return;
    }
    const unlockAt = eventStartTime + EVENT_INTRO_COUNTDOWN_MS;
    const remaining = unlockAt - Date.now();
    if (remaining <= 0) {
      setIntroCountdownDone(true);
      return;
    }
    setIntroCountdownDone(false);
    const id = setTimeout(() => setIntroCountdownDone(true), remaining);
    return () => clearTimeout(id);
  }, [eventStarted, eventStartTime]);

  const [demoMarket, setDemoMarket] = useState<Record<string, MarketTicker>>(() => createDemoMarket());
  const [demoPlayer, setDemoPlayer] = useState<Player>(() => loadDemoPlayer(createDemoMarket()));
  const [meta, setMeta] = useState<PaperMeta>(() => ({
    enabled: demoMode,
    eventStarted: demoMode,
    startingBalance: demoMode ? DEMO_STARTING_BALANCE : 10000,
    marketDataSource: 'kraken',
    pairs: demoMode ? DEMO_PAIRS : [],
    market: demoMode ? demoMarket : {},
    marketMetadata: {},
    fees: { maker: DEMO_MAKER_FEE, taker: DEMO_TAKER_FEE, spreadBps: 1, minLeverage: 1, maxLeverage: 50 },
  }));
  // Initialize the session synchronously from the bootstrap cache deposited
  // by CompetitionPlatform when the user clicked "TRADER". This avoids the
  // flash of the "Acces requis" placeholder while we wait for /api/paper/me
  // to come back. The terminal still revalidates in the background and the
  // WebSocket pushes live updates as soon as it connects.
  const [session, setSession] = useState<{ token: string; player: SessionPlayer } | null>(() => {
    if (demoMode) {
      return { token: 'demo-token', player: { id: 'tradingview-demo', name: 'TradingView Demo', color: '#dc2626', avatar: null } };
    }
    const platform = getTerminalPlatformFromUrl();
    const token = readPaperSessionToken(platform);
    const cached = readPaperBootstrapCache();
    const competitionId = getCompetitionIdFromUrl();
    if (token && cached && isPaperBootstrapCacheValid(cached, platform, token, competitionId)) {
      return { token: cached.token, player: cached.player as SessionPlayer };
    }
    return null;
  });
  // True until we have either confirmed the session via /api/paper/me or
  // determined that there is no token to validate. While this flag is true
  // we never render the "Acces requis" placeholder, so a logged-in user
  // simply sees a loading state instead of a brief error popup.
  const [bootstrapping, setBootstrapping] = useState(() => {
    if (demoMode) return false;
    return Boolean(readPaperSessionToken(getTerminalPlatformFromUrl()));
  });
  const [accessCode, setAccessCode] = useState('');
  const [selectedPair, setSelectedPair] = useState('BTC/USD');
  const [side, setSide] = useState<'long' | 'short'>('short');
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [size, setSize] = useState('0.00005');
  const [limitPrice, setLimitPrice] = useState('');
  const [leverage, setLeverage] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'positions' | 'ordres' | 'historique'>('positions');
  const [mobileTab, setMobileTab] = useState<MobileTerminalTab>('orders');
  const [bottomTabsHeight, setBottomTabsHeight] = useState(190);
  const [bottomTabsExpanded, setBottomTabsExpanded] = useState(false);
  const bottomResizeRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
    previousCursor: string;
    previousUserSelect: string;
  } | null>(null);
  const [chartInterval, setChartInterval] = useState(1);
  const [orderPreview, setOrderPreview] = useState<ChartOrderPreview | null>(null);
  const [tpSlEnabled, setTpSlEnabled] = useState(false);
  const [takeProfitInput, setTakeProfitInput] = useState('');
  const [stopLossInput, setStopLossInput] = useState('');
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 1023px)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 1023px)');
    const handler = (event: MediaQueryListEvent) => setIsMobileViewport(event.matches);
    setIsMobileViewport(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
  const [competitionContext, setCompetitionContext] = useState<CompetitionContext | null>(null);
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardResponse | null>(null);
  const [leaderboardError, setLeaderboardError] = useState('');

  // Mode Live (BTF event roster) vs compétition online Compete.
  // L'URL indique l'intention (`?live=true` vs `?competitionId=`), mais la
  // session serveur (`/api/paper/me`) fait foi : une session Compete ne doit
  // jamais afficher l'UI Live, et inversement.
  const [liveMode, setLiveMode] = useState<boolean>(() => (
    !demoMode && terminalPlatform === 'live'
  ));

  const [livePlayer, setLivePlayer] = useState<Player | null>(null);
  const [liveMarket, setLiveMarket] = useState<Record<string, MarketTicker> | null>(null);
  const [liveCanTrade, setLiveCanTrade] = useState<boolean | null>(null);
  const chartLiveTickRef = useRef<ChartLiveTickHandler | null>(null);

  const clearOrderDraftRisk = useCallback(() => {
    setOrderPreview(null);
    setTpSlEnabled(false);
    setTakeProfitInput('');
    setStopLossInput('');
  }, []);

  const resetLimitOrderDraft = useCallback(() => {
    setSize('0');
    clearOrderDraftRisk();
  }, [clearOrderDraftRisk]);

  // Tracks ids of positions/orders that the user has just closed/cancelled
  // optimistically. Each entry expires after a short delay so an in-flight
  // WS paper:update broadcast (which still contains the just-closed
  // position) cannot make it visually re-appear before the server-side
  // close has been broadcasted. Once expired, the filter releases the id
  // either way so a real server divergence is never hidden permanently.
  const pendingClosedPositionsRef = useRef<Map<string, number>>(new Map());
  const pendingCancelledOrdersRef = useRef<Map<string, number>>(new Map());
  // Partial closes track the size we've already removed locally so the
  // visible position size keeps shrinking instead of bouncing back to its
  // pre-close value when an old WS payload arrives.
  const pendingPartialClosesRef = useRef<Map<string, { delta: number; expiresAt: number }>>(new Map());

  const PENDING_MUTATION_TTL_MS = 4000;

  const markPositionPendingClose = useCallback((positionId: string) => {
    pendingClosedPositionsRef.current.set(positionId, Date.now() + PENDING_MUTATION_TTL_MS);
  }, []);
  const markOrderPendingCancel = useCallback((orderId: string) => {
    pendingCancelledOrdersRef.current.set(orderId, Date.now() + PENDING_MUTATION_TTL_MS);
  }, []);
  const markPositionPendingPartial = useCallback((positionId: string, delta: number) => {
    const existing = pendingPartialClosesRef.current.get(positionId);
    pendingPartialClosesRef.current.set(positionId, {
      delta: (existing?.delta || 0) + delta,
      expiresAt: Date.now() + PENDING_MUTATION_TTL_MS,
    });
  }, []);

  const reconcilePlayerWithPending = useCallback((incoming: Player | null): Player | null => {
    if (!incoming) return incoming;
    const now = Date.now();

    // Drop expired entries first so they cannot mask real state divergence.
    for (const [id, expiresAt] of pendingClosedPositionsRef.current) {
      if (expiresAt <= now) pendingClosedPositionsRef.current.delete(id);
    }
    for (const [id, expiresAt] of pendingCancelledOrdersRef.current) {
      if (expiresAt <= now) pendingCancelledOrdersRef.current.delete(id);
    }
    for (const [id, info] of pendingPartialClosesRef.current) {
      if (info.expiresAt <= now) pendingPartialClosesRef.current.delete(id);
    }

    const openPositions = (incoming.openPositions || []).reduce<Position[]>((acc, position) => {
      if (pendingClosedPositionsRef.current.has(position.id)) {
        // Server has not yet processed (or broadcast) the close, so keep
        // hiding the position. Once it really disappears from the payload
        // we can release the marker.
        return acc;
      }
      const partial = pendingPartialClosesRef.current.get(position.id);
      if (partial && partial.delta > 0) {
        const newSize = position.size - partial.delta;
        if (newSize <= 0.000_000_1) {
          // Effective full close while the user requested a partial: drop
          // it entirely and clear the pending entry.
          pendingPartialClosesRef.current.delete(position.id);
          return acc;
        }
        acc.push({ ...position, size: newSize });
        return acc;
      }
      acc.push(position);
      return acc;
    }, []);

    // If the incoming payload no longer contains a pending-closed id, the
    // optimistic update has been confirmed: drop the marker so any future
    // payload is rendered unchanged.
    const incomingPositionIds = new Set((incoming.openPositions || []).map((p) => p.id));
    for (const id of Array.from(pendingClosedPositionsRef.current.keys())) {
      if (!incomingPositionIds.has(id)) pendingClosedPositionsRef.current.delete(id);
    }
    for (const id of Array.from(pendingPartialClosesRef.current.keys())) {
      if (!incomingPositionIds.has(id)) pendingPartialClosesRef.current.delete(id);
    }

    const openOrders = (incoming.openOrders || []).filter(
      (order) => !pendingCancelledOrdersRef.current.has(order.id),
    );
    const incomingOrderIds = new Set((incoming.openOrders || []).map((o) => o.id));
    for (const id of Array.from(pendingCancelledOrdersRef.current.keys())) {
      if (!incomingOrderIds.has(id)) pendingCancelledOrdersRef.current.delete(id);
    }

    return { ...incoming, openPositions, openOrders };
  }, []);

  const applyPaperUpdate = useCallback((data: any) => {
    const marketSnapshot = data?.market as Record<string, MarketTicker> | undefined;
    if (marketSnapshot) setLiveMarket(marketSnapshot);
    if (data?.player) {
      const reconciled = reconcilePlayerWithPending(data.player as Player);
      if (reconciled) {
        setLivePlayer(
          marketSnapshot
            ? refreshPlayerPaperMetrics(reconciled, marketSnapshot, meta.startingBalance)
            : reconciled,
        );
      }
    }
    if (typeof data?.canTrade === 'boolean') setLiveCanTrade(data.canTrade);
    mergeCompetitionFromMe(data?.competition);
  }, [meta.startingBalance, reconcilePlayerWithPending]);

  const applyMarketTick = useCallback((data: {
    ticks?: Array<{ pair: string; markPrice: number; bidPrice?: number; askPrice?: number; updatedAt?: number }>;
  }) => {
    const ticks = data?.ticks;
    if (!Array.isArray(ticks) || ticks.length === 0) return;

    for (const tick of ticks) {
      if (!tick?.pair || !Number.isFinite(tick.markPrice) || tick.markPrice <= 0) continue;
      chartLiveTickRef.current?.(tick.pair, tick.markPrice, tick.updatedAt || Date.now());
    }

    setLiveMarket((prev) => {
      const base = prev ? { ...prev } : {};
      let changed = false;
      for (const tick of ticks) {
        if (!tick?.pair || !Number.isFinite(tick.markPrice) || tick.markPrice <= 0) continue;
        const existing = base[tick.pair];
        base[tick.pair] = {
          pair: tick.pair,
          symbol: existing?.symbol ?? tick.pair,
          markPrice: tick.markPrice,
          bidPrice: tick.bidPrice ?? tick.markPrice,
          askPrice: tick.askPrice ?? tick.markPrice,
          change24h: existing?.change24h ?? null,
          spreadBps: existing?.spreadBps ?? 0,
          updatedAt: tick.updatedAt || Date.now(),
        };
        changed = true;
      }
      if (changed) {
        setLivePlayer((player) => (
          player ? refreshPlayerPaperMetrics(player, base, meta.startingBalance) : player
        ));
      }
      return changed ? base : prev;
    });
  }, [meta.startingBalance]);

  const applyArenaInit = useCallback((payload: any) => {
    if (!payload?.competition || !Array.isArray(payload?.leaderboard)) return;
    setLeaderboardData({
      competition: payload.competition,
      leaderboard: payload.leaderboard,
    } as LeaderboardResponse);
    setLeaderboardError('');
  }, []);

  const applyArenaPatch = useCallback((payload: any) => {
    if (!payload?.competitionId) return;
    setLeaderboardData((prev) => {
      if (!prev) return prev;
      if (prev.competition.id !== payload.competitionId) return prev;
      const upserts = Array.isArray(payload.upserts) ? payload.upserts : [];
      const removed: string[] = Array.isArray(payload.removed) ? payload.removed : [];
      const byUserId = new Map<string, LeaderboardRow>();
      for (const row of prev.leaderboard) byUserId.set(row.userId, row);
      for (const id of removed) byUserId.delete(id);
      for (const upsert of upserts) {
        if (!upsert?.userId) continue;
        const existing = byUserId.get(upsert.userId);
        const merged: LeaderboardRow = {
          rank: upsert.rank ?? existing?.rank ?? 0,
          userId: upsert.userId,
          name: upsert.name ?? existing?.name ?? 'Participant',
          // Patches don't always carry the avatar; preserve the previous one
          // unless the diff explicitly provides a new value (incl. null reset).
          avatarUrl: upsert.avatarUrl !== undefined ? upsert.avatarUrl : existing?.avatarUrl ?? null,
          pnlPercent: upsert.pnlPercent ?? existing?.pnlPercent ?? 0,
          pnlUsd: upsert.pnlUsd ?? existing?.pnlUsd ?? 0,
          tradesCount: upsert.tradesCount ?? existing?.tradesCount ?? 0,
          updatedAt: upsert.updatedAt ?? existing?.updatedAt ?? Date.now(),
        };
        byUserId.set(upsert.userId, merged);
      }
      const next = Array.from(byUserId.values()).sort(
        (a, b) => a.rank - b.rank || b.pnlPercent - a.pnlPercent,
      );
      return {
        competition: payload.competition || prev.competition,
        leaderboard: next,
      };
    });
  }, []);

  useWebSocket(!demoMode, {
    paperToken: session?.token || null,
    onPaperUpdate: applyPaperUpdate,
    onMarketTick: applyMarketTick,
    onArenaInit: applyArenaInit,
    onArenaPatch: applyArenaPatch,
  });

  const market = useMemo(() => {
    if (demoMode) return demoMarket;
    if (liveMarket && Object.keys(liveMarket).length > 0) return liveMarket;
    if (Object.keys(wsMarket).length > 0) return wsMarket;
    return meta.market;
  }, [demoMarket, demoMode, liveMarket, wsMarket, meta.market]);
  const ticker = market[selectedPair];

  const wsPlayer = useMemo(
    () => (
      competitionContext?.id || !liveMode
        ? null
        : (session ? players.find((entry) => entry.id === session.player.id) || null : null)
    ),
    [competitionContext?.id, liveMode, players, session],
  );
  const player = useMemo(() => {
    if (demoMode) return demoPlayer;
    if (competitionContext?.id) return livePlayer;
    // Le feed paper (/me + WS) fait foi sur le terminal ; le store dashboard
    // n'est qu'un repli pendant le chargement initial.
    if (livePlayer) return livePlayer;
    return wsPlayer;
  }, [competitionContext?.id, demoMode, demoPlayer, livePlayer, wsPlayer]);

  const playerTrades = useMemo(() => {
    if (demoMode) {
      return [...demoPlayer.trades].sort((a, b) => b.time - a.time).slice(0, 30);
    }
    if (livePlayer?.trades?.length) {
      return [...livePlayer.trades].sort((a, b) => b.time - a.time).slice(0, 30);
    }
    if (competitionContext?.id || !liveMode) return [];
    if (!player) return [];
    return recentTrades.filter((trade) => trade.playerName === player.name).slice(0, 30);
  }, [competitionContext?.id, demoMode, demoPlayer.trades, liveMode, livePlayer, player, recentTrades]);

  useEffect(() => {
    if (!demoMode) return;

    const id = window.setInterval(() => {
      setDemoMarket((current) => {
        const next: Record<string, MarketTicker> = {};
        for (const pair of DEMO_PAIRS) {
          const ticker = current[pair];
          const base = DEMO_PRICE_BASE[pair];
          const drift = (Math.random() - 0.48) * base.volatility;
          const anchor = (base.price - ticker.markPrice) * 0.0006;
          const markPrice = Math.max(ticker.markPrice + drift + anchor, base.price * 0.2);
          next[pair] = {
            ...ticker,
            markPrice,
            bidPrice: markPrice * 0.99995,
            askPrice: markPrice * 1.00005,
            updatedAt: Date.now(),
          };
        }
        return next;
      });
    }, 900);

    return () => window.clearInterval(id);
  }, [demoMode]);

  useEffect(() => {
    if (!demoMode) return;
    setDemoPlayer((current) => {
      const openOrders = current.openOrders.filter((order) => order.status === 'open' && order.limitPrice != null);
      if (openOrders.length === 0) return current;

      let changed = false;
      let feesAdded = 0;
      let filledCount = 0;
      const remainingOrders = [...current.openOrders];
      const newPositions = [...current.openPositions];
      const newTrades = [...current.trades];

      for (const order of openOrders) {
        const ticker = demoMarket[order.pair];
        const limitPrice = order.limitPrice;
        if (!ticker || limitPrice == null) continue;
        const placedAtMark = order.placedAtMark != null && order.placedAtMark > 0
          ? order.placedAtMark
          : ticker.markPrice;
        if (!isRestingLimitTriggered(order.side, limitPrice, placedAtMark, ticker.markPrice)) continue;

        changed = true;
        filledCount += 1;
        const fillPrice = limitPrice;
        const idx = remainingOrders.findIndex((entry) => entry.id === order.id);
        if (idx >= 0) remainingOrders.splice(idx, 1);

        const notional = fillPrice * order.size;
        const margin = notional / order.leverage;
        const fee = notional * DEMO_MAKER_FEE;
        feesAdded += fee;
        const openedAt = Date.now();
        newPositions.unshift({
          id: order.id,
          pair: order.pair,
          side: order.side,
          size: order.size,
          entryPrice: fillPrice,
          markPrice: ticker.markPrice,
          pnl: 0,
          unrealizedFunding: 0,
          leverage: order.leverage,
          margin,
          feesPaid: fee,
          liquidationPrice: order.side === 'long'
            ? fillPrice * (1 - 0.9 / order.leverage)
            : fillPrice * (1 + 0.9 / order.leverage),
          stopLoss: order.stopLoss ?? null,
          takeProfit: order.takeProfit ?? null,
          openedAt,
        });
        newTrades.unshift({
          id: order.id,
          playerName: current.name,
          playerColor: current.color,
          pair: order.pair,
          side: order.side,
          size: order.size,
          price: fillPrice,
          fee,
          leverage: order.leverage,
          orderType: 'limit',
          pnl: 0,
          time: openedAt,
          action: 'open',
        });
      }

      if (!changed) return current;
      return normalizeDemoPlayer({
        ...current,
        feesPaid: current.feesPaid + feesAdded,
        tradeCount: current.tradeCount + filledCount,
        openOrders: remainingOrders,
        openPositions: newPositions,
        trades: newTrades.slice(0, 60),
      }, demoMarket);
    });
  }, [demoMode, demoMarket]);

  useEffect(() => {
    if (!demoMode) return;
    setDemoPlayer((current) => normalizeDemoPlayer(current, demoMarket));
    setMeta((current) => ({ ...current, market: demoMarket }));
  }, [demoMarket, demoMode]);

  useEffect(() => {
    if (!demoMode) return;
    window.localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(demoPlayer));
  }, [demoMode, demoPlayer]);

  useEffect(() => {
    if (demoMode) return;
    const params = new URLSearchParams(window.location.search);
    const code = (params.get('code') || '').trim().toUpperCase();
    const competitionId = (params.get('competitionId') || '').trim();
    const competitionTitle = (params.get('competitionTitle') || '').trim();
    const competitionMode = params.get('competitionMode') === 'real' ? 'real' : 'paper';
    if (code) setAccessCode(code);
    if (competitionId || competitionTitle) {
      setCompetitionContext({
        id: competitionId || 'unknown',
        title: competitionTitle || 'Competition',
        mode: competitionMode,
      });
    }
  }, [demoMode]);

  function mergeCompetitionFromMe(payload: any) {
    const extracted = extractPaperCompetitionContext(
      payload?.competition != null && typeof payload === 'object' && !payload.player
        ? { competition: payload }
        : payload,
    );
    if (!extracted?.id) return;
    setCompetitionContext((prev) => ({
      id: extracted.id,
      title: extracted.title || prev?.title || 'Competition',
      mode: extracted.executionMode === 'real' ? 'real' : (prev?.mode || 'paper'),
      userId: extracted.userId ?? prev?.userId ?? null,
      startAt: extracted.startAt ?? prev?.startAt,
      endAt: extracted.endAt ?? prev?.endAt,
      status: (extracted.status as CompetitionContext['status']) ?? prev?.status,
      participants: extracted.participants ?? prev?.participants,
      rank: extracted.rank ?? prev?.rank ?? null,
      pnlPercent: extracted.pnlPercent ?? prev?.pnlPercent,
    }));
  }

  function reconcileTerminalSession(
    token: string,
    payload: { competition?: unknown } | null | undefined,
  ): boolean {
    const competition = extractPaperCompetitionContext(payload);

    // Session ONLINE sur une URL LIVE → renvoyer vers le bon terminal Compete.
    if (terminalPlatform === 'live' && competition?.id) {
      clearPaperSessionToken('live');
      writePaperSessionToken('compete', token);
      window.location.replace(buildCompeteTradeUrl({
        id: competition.id,
        title: competition.title,
        executionMode: competition.executionMode,
      }));
      return false;
    }

    if (!paperSessionMatchesPlatform(payload, terminalPlatform, urlCompetitionId)) {
      clearPaperSessionToken(terminalPlatform);
      return false;
    }

    writePaperSessionToken(terminalPlatform, token);
    return true;
  }

  useEffect(() => {
    if (demoMode) return;
    const hasCompetition = Boolean(competitionContext?.id);
    setLiveMode(terminalPlatform === 'live' && !hasCompetition);
  }, [competitionContext?.id, demoMode, terminalPlatform]);

  useEffect(() => {
    if (demoMode) return;
    fetch('/api/paper/meta')
      .then((response) => response.json())
      .then((data: PaperMeta) => {
        setMeta(data);
        if (data.pairs.length > 0) {
          setSelectedPair((current) => (data.pairs.includes(current) ? current : data.pairs[0]));
        }
      });
  }, [demoMode]);

  useEffect(() => {
    if (demoMode) return;
    const token = readPaperSessionToken(terminalPlatform);
    if (!token) {
      setSession(null);
      setLivePlayer(null);
      setLiveMarket(null);
      setLiveCanTrade(null);
      setBootstrapping(false);
      return;
    }

    setBootstrapping(true);

    const cached = readPaperBootstrapCache();
    if (cached && isPaperBootstrapCacheValid(cached, terminalPlatform, token, urlCompetitionId)) {
      setLivePlayer(cached.player as Player);
      if (cached.market) setLiveMarket(cached.market as Record<string, MarketTicker>);
      if (typeof cached.canTrade === 'boolean') setLiveCanTrade(cached.canTrade);
      mergeCompetitionFromMe(cached.competition);
    }

    fetch('/api/paper/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        if (!response.ok) {
          clearPaperSessionToken(terminalPlatform);
          return null;
        }
        return response.json();
      })
      .then((data) => {
        if (!data?.player) {
          setSession(null);
          setLivePlayer(null);
          return;
        }
        if (!reconcileTerminalSession(token, data)) {
          setSession(null);
          setLivePlayer(null);
          setLiveMarket(null);
          setLiveCanTrade(null);
          return;
        }
        setSession({ token, player: data.player });
        setLivePlayer(reconcilePlayerWithPending(data.player as Player));
        if (data.market) setLiveMarket(data.market);
        if (typeof data.canTrade === 'boolean') setLiveCanTrade(data.canTrade);
        mergeCompetitionFromMe(data);
      })
      .finally(() => {
        setBootstrapping(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoMode, terminalPlatform, urlCompetitionId, location.search]);

  useEffect(() => {
    if (demoMode) return;
    if (!session) {
      setLivePlayer(null);
      setLiveMarket(null);
      setLiveCanTrade(null);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      if (cancelled || !session) return;
      try {
        const response = await fetch('/api/paper/me', {
          headers: { Authorization: `Bearer ${session.token}` },
        });
        if (cancelled) return;
        if (response.status === 401) {
          clearPaperSessionToken(terminalPlatform);
          setSession(null);
          return;
        }
        if (!response.ok) return;
        const data = await response.json();
        if (cancelled) return;
        if (!reconcileTerminalSession(session.token, data)) {
          setSession(null);
          setLivePlayer(null);
          setLiveMarket(null);
          setLiveCanTrade(null);
          return;
        }
        if (data?.player) setLivePlayer(reconcilePlayerWithPending(data.player as Player));
        if (data?.market) setLiveMarket(data.market);
        if (typeof data?.canTrade === 'boolean') setLiveCanTrade(data.canTrade);
        mergeCompetitionFromMe(data?.competition);
      } catch {
        // soft fail; we'll retry on the next tick.
      } finally {
        // WebSocket paper:update is now the primary live feed; polling remains
        // only as a safety net if the socket disconnects.
        if (!cancelled) timer = setTimeout(tick, 5000);
      }
    }

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [demoMode, session, terminalPlatform]);

  useEffect(() => {
    if (orderType === 'limit' && ticker && !limitPrice) {
      const category = meta.marketMetadata[selectedPair]?.category;
      const price = ticker.markPrice;
      let formatted: string;
      if (category === 'forex') formatted = price.toFixed(5);
      else if (price >= 1000) formatted = price.toFixed(2);
      else if (price >= 1) formatted = price.toFixed(4);
      else formatted = Number(price.toPrecision(6)).toString();
      setLimitPrice(formatted);
    }
  }, [orderType, ticker, limitPrice, meta.marketMetadata, selectedPair]);

  useEffect(() => {
    const competitionId = competitionContext?.id;
    if (demoMode || !competitionId || competitionId === 'unknown') {
      setLeaderboardData(null);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // The arena WS shard is now the primary feed for the leaderboard.
    // We still poll the HTTP endpoint as a safety net at a much lower
    // frequency (30s) so the UI recovers if the socket drops.
    async function tick() {
      try {
        const response = await fetch(`/api/competition/leaderboard/${competitionId}`);
        const payload = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(payload.error || 'Leaderboard indisponible');
        setLeaderboardData((prev) => prev || (payload as LeaderboardResponse));
        setLeaderboardError('');
      } catch (err: unknown) {
        if (!cancelled) setLeaderboardError(err instanceof Error ? err.message : 'Leaderboard indisponible');
      } finally {
        if (!cancelled) timer = setTimeout(tick, 30000);
      }
    }

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [competitionContext?.id, demoMode]);

  async function login() {
    if (!liveMode || terminalPlatform !== 'live') return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/paper/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessCode }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Connexion impossible');
      writePaperSessionToken('live', data.token);
      setSession({ token: data.token, player: data.player });
      setAccessCode('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function pushDemoPlayer(updater: (player: Player) => Player) {
    setDemoPlayer((current) => normalizeDemoPlayer(updater(current), demoMarket));
  }

  function updateDemoOrderLimit(orderId: string, limitPrice: number) {
    pushDemoPlayer((current) => {
      const order = current.openOrders.find((entry) => entry.id === orderId);
      if (!order || order.limitPrice == null) return current;

      const notional = limitPrice * order.size;
      const marginRequired = notional / order.leverage;
      const feeEstimate = notional * DEMO_MAKER_FEE;

      return {
        ...current,
        openOrders: current.openOrders.map((entry) => (
          entry.id === orderId
            ? {
                ...entry,
                limitPrice,
                marginReserved: marginRequired,
                feeEstimate,
                updatedAt: Date.now(),
              }
            : entry
        )),
      };
    });
  }

  function updateDemoOrderRisk(
    orderId: string,
    stopLoss: number | null,
    takeProfit: number | null,
  ) {
    pushDemoPlayer((current) => ({
      ...current,
      openOrders: current.openOrders.map((order) => (
        order.id === orderId
          ? { ...order, stopLoss, takeProfit, updatedAt: Date.now() }
          : order
      )),
    }));
  }

  function submitDemoOrder(extras?: { stopLoss: number | null; takeProfit: number | null }) {
    const currentTicker = demoMarket[selectedPair];
    if (!currentTicker) return;

    const qty = engineSizeFromInput(selectedPair, Number(size));
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Quantité invalide pour la démo.');
      return;
    }

    if (orderType === 'limit') {
      const limit = Number(limitPrice);
      if (!Number.isFinite(limit) || limit <= 0) {
        setError('Prix limite invalide.');
        return;
      }
      const notional = limit * qty;
      const margin = leverage > 0 ? notional / leverage : 0;
      const fee = notional * DEMO_MAKER_FEE;
      if (margin + fee > demoPlayer.availableMargin) {
        setError('Marge demo insuffisante.');
        return;
      }
      const openedAt = Date.now();
      const order = {
        id: crypto.randomUUID(),
        pair: selectedPair,
        side,
        size: qty,
        orderType: 'limit' as const,
        status: 'open' as const,
        limitPrice: limit,
        leverage,
        marginReserved: margin,
        feeEstimate: fee,
        createdAt: openedAt,
        updatedAt: openedAt,
        stopLoss: extras?.stopLoss ?? null,
        takeProfit: extras?.takeProfit ?? null,
        placedAtMark: currentTicker.markPrice,
      };
      setError('');
      pushDemoPlayer((current) => ({
        ...current,
        openOrders: [order, ...current.openOrders],
      }));
      resetLimitOrderDraft();
      return;
    }

    const price = side === 'long' ? currentTicker.askPrice : currentTicker.bidPrice;
    const notional = price * qty;
    const margin = leverage > 0 ? notional / leverage : 0;
    const fee = notional * DEMO_TAKER_FEE;

    if (margin + fee > demoPlayer.availableMargin) {
      setError('Marge demo insuffisante.');
      return;
    }

    const openedAt = Date.now();
    const positionId = crypto.randomUUID();
    const position: Position = {
      id: positionId,
      pair: selectedPair,
      side,
      size: qty,
      entryPrice: price,
      markPrice: currentTicker.markPrice,
      pnl: 0,
      unrealizedFunding: 0,
      leverage,
      margin,
      feesPaid: fee,
      liquidationPrice: side === 'long'
        ? price * (1 - 0.9 / leverage)
        : price * (1 + 0.9 / leverage),
      stopLoss: extras?.stopLoss ?? null,
      takeProfit: extras?.takeProfit ?? null,
      openedAt,
    };
    const trade: Trade = {
      id: positionId,
      playerName: demoPlayer.name,
      playerColor: demoPlayer.color,
      pair: selectedPair,
      side,
      size: qty,
      price,
      fee,
      leverage,
      orderType,
      pnl: 0,
      time: openedAt,
      action: 'open',
    };

    setError('');
    pushDemoPlayer((current) => ({
      ...current,
      feesPaid: current.feesPaid + fee,
      tradeCount: current.tradeCount + 1,
      openPositions: [position, ...current.openPositions],
      trades: [trade, ...current.trades].slice(0, 60),
    }));
    clearOrderDraftRisk();
    setOrderPreview(null);
  }

  function closeDemoPosition(positionId: string, partialSize?: number) {
    const position = demoPlayer.openPositions.find((entry) => entry.id === positionId)
      ?? demoPlayer.openPositions.find((entry) => entry.pair === positionId);
    if (!position) return;

    const pair = position.pair;
    const ticker = demoMarket[pair];
    const price = position.side === 'long' ? ticker.bidPrice : ticker.askPrice;
    const closeSize = Math.max(0, Math.min(position.size, partialSize ?? position.size));
    if (closeSize <= 0) return;

    const sizeRatio = closeSize / position.size;
    const pnl = (price - position.entryPrice) * closeSize * (position.side === 'long' ? 1 : -1);
    const fee = price * closeSize * DEMO_TAKER_FEE;
    const closedAt = Date.now();
    const trade: Trade = {
      id: crypto.randomUUID(),
      playerName: demoPlayer.name,
      playerColor: demoPlayer.color,
      pair,
      side: position.side,
      size: closeSize,
      price,
      fee,
      leverage: position.leverage,
      orderType: 'market',
      pnl,
      time: closedAt,
      action: 'close',
    };

    pushDemoPlayer((current) => {
      const openPositions = current.openPositions.flatMap((entry) => {
        if (entry.id !== position.id) return [entry];
        if (closeSize >= entry.size - 1e-10) return [];
        return [{
          ...entry,
          size: entry.size - closeSize,
          margin: entry.margin * (1 - sizeRatio),
          feesPaid: entry.feesPaid * (1 - sizeRatio),
          stopLossSize: entry.stopLossSize ? Math.min(entry.stopLossSize, entry.size - closeSize) : entry.stopLossSize,
          takeProfitSize: entry.takeProfitSize ? Math.min(entry.takeProfitSize, entry.size - closeSize) : entry.takeProfitSize,
        }];
      });

      return {
        ...current,
        feesPaid: current.feesPaid + fee,
        tradeCount: current.tradeCount + 1,
        openPositions,
        trades: [trade, ...current.trades].slice(0, 60),
      };
    });
  }

  function updateDemoRisk(
    positionId: string,
    stopLoss: number | null,
    takeProfit: number | null,
    options?: { stopLossSize?: number | null; takeProfitSize?: number | null },
  ) {
    pushDemoPlayer((current) => ({
      ...current,
      openPositions: current.openPositions.map((position) => (
        position.id === positionId || position.pair === positionId
          ? {
              ...position,
              stopLoss,
              takeProfit,
              stopLossSize: options?.stopLossSize ?? null,
              takeProfitSize: options?.takeProfitSize ?? null,
            }
          : position
      )),
    }));
  }

  async function submitOrder(extras?: { stopLoss: number | null; takeProfit: number | null }) {
    const qty = engineSizeFromInput(selectedPair, Number(size));
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Quantité invalide. Entre une quantité supérieure à 0.');
      return;
    }
    if (demoMode) {
      submitDemoOrder(extras);
      return;
    }
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/paper/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          pair: selectedPair,
          side,
          size: qty,
          orderType,
          limitPrice: orderType === 'limit' ? Number(limitPrice) : null,
          leverage,
          stopLoss: extras?.stopLoss ?? null,
          takeProfit: extras?.takeProfit ?? null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Ordre refusé');
      if (orderType === 'limit') {
        resetLimitOrderDraft();
      } else {
        clearOrderDraftRisk();
      }
      void refreshLive();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelOrder(orderId: string) {
    if (demoMode) return void orderId;
    if (!session) return;
    setBusy(true);
    setError('');
    // Optimistic UI: hide the order immediately. The next /me poll or WS
    // paper:update will reconcile the state if the server rejects the call.
    markOrderPendingCancel(orderId);
    setLivePlayer((prev) =>
      prev ? { ...prev, openOrders: prev.openOrders.filter((o: any) => o.id !== orderId) } : prev,
    );
    try {
      const response = await fetch('/api/paper/cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ orderId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const msg = String(data?.error || 'Annulation refusée');
        // Race with auto-execution: treat as success if the order is gone.
        if (!msg.includes('Ordre introuvable')) throw new Error(msg);
      }
      void refreshLive();
    } catch (err: any) {
      setError(err.message);
      void refreshLive();
    } finally {
      setBusy(false);
    }
  }

  async function closePosition(positionId: string, partialSize?: number) {
    if (demoMode) {
      closeDemoPosition(positionId, partialSize);
      return;
    }
    if (!session) return;
    setBusy(true);
    setError('');
    // Optimistic UI: remove (or shrink) the position immediately so the user
    // gets instant feedback even if the server response is delayed by a slow
    // network. The pending mutation marker prevents an in-flight WS
    // paper:update from "uncoincidentally" un-closing it for a few hundred
    // ms before the server-side close has been broadcasted.
    if (partialSize == null) {
      markPositionPendingClose(positionId);
      setLivePlayer((prev) =>
        prev
          ? { ...prev, openPositions: prev.openPositions.filter((p: any) => p.id !== positionId) }
          : prev,
      );
    } else {
      markPositionPendingPartial(positionId, partialSize);
      setLivePlayer((prev) =>
        prev
          ? {
              ...prev,
              openPositions: prev.openPositions
                .map((p: any) =>
                  p.id === positionId
                    ? { ...p, size: Math.max(0, p.size - partialSize) }
                    : p,
                )
                .filter((p: any) => p.size > 0),
            }
          : prev,
      );
    }
    try {
      const response = await fetch('/api/paper/close', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ positionId, size: partialSize ?? null }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const msg = String(data?.error || 'Clôture refusée');
        // Race with SL/TP trigger: position is already closed, that's fine.
        if (!msg.includes('Position introuvable')) throw new Error(msg);
      }
      void refreshLive();
    } catch (err: any) {
      setError(err.message);
      void refreshLive();
    } finally {
      setBusy(false);
    }
  }

  async function updateOrderLimit(orderId: string, limitPrice: number) {
    if (demoMode) {
      updateDemoOrderLimit(orderId, limitPrice);
      return;
    }
    if (!session) return;
    setError('');
    setLivePlayer((prev) => (
      prev
        ? {
            ...prev,
            openOrders: prev.openOrders.map((order) => (
              order.id === orderId ? { ...order, limitPrice } : order
            )),
          }
        : prev
    ));
    try {
      const response = await fetch('/api/paper/order/limit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ orderId, limitPrice }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Modification du prix limite refusée');
      void refreshLive();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Modification du prix limite refusée');
      void refreshLive();
    }
  }

  async function updateOrderRisk(
    orderId: string,
    stopLoss: number | null,
    takeProfit: number | null,
  ) {
    if (demoMode) {
      updateDemoOrderRisk(orderId, stopLoss, takeProfit);
      return;
    }
    if (!session) return;
    setError('');
    const response = await fetch('/api/paper/risk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({ orderId, stopLoss, takeProfit }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Modification SL/TP refusée');
    void refreshLive();
  }

  async function updateRisk(
    positionId: string,
    stopLoss: number | null,
    takeProfit: number | null,
    options?: { stopLossSize?: number | null; takeProfitSize?: number | null },
  ) {
    if (demoMode) {
      updateDemoRisk(positionId, stopLoss, takeProfit, options);
      return;
    }
    if (!session) return;
    setError('');
    const response = await fetch('/api/paper/risk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({
        positionId,
        stopLoss,
        takeProfit,
        stopLossSize: options?.stopLossSize ?? null,
        takeProfitSize: options?.takeProfitSize ?? null,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Modification SL/TP refusée');
    void refreshLive();
  }

  async function refreshLive() {
    if (demoMode) return;
    if (!session) return;
    try {
      const response = await fetch('/api/paper/me', {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      if (!response.ok) return;
      const data = await response.json();
      if (data?.player) setLivePlayer(reconcilePlayerWithPending(data.player as Player));
      if (data?.market) setLiveMarket(data.market);
      if (typeof data?.canTrade === 'boolean') setLiveCanTrade(data.canTrade);
    } catch {
      /* noop */
    }
  }

  function logout() {
    if (demoMode) return;
    clearAllPaperSessions();
    setSession(null);
    setLivePlayer(null);
    setLiveMarket(null);
    setLiveCanTrade(null);
    if (liveMode && typeof window !== 'undefined') {
      window.location.replace('/trader');
    }
  }

  function startBottomResize(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    bottomResizeRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: bottomTabsHeight,
      previousCursor: document.body.style.cursor,
      previousUserSelect: document.body.style.userSelect,
    };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }

  function moveBottomResize(event: PointerEvent<HTMLDivElement>) {
    const resize = bottomResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    const minHeight = 150;
    const maxHeight = 340;
    const nextHeight = resize.startHeight + (resize.startY - event.clientY);
    setBottomTabsHeight(Math.max(minHeight, Math.min(maxHeight, nextHeight)));
  }

  function endBottomResize(event: PointerEvent<HTMLDivElement>) {
    const resize = bottomResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.body.style.cursor = resize.previousCursor;
    document.body.style.userSelect = resize.previousUserSelect;
    bottomResizeRef.current = null;
  }

  const livePaperMode = (competitionContext?.mode === 'paper') || platformMode === 'paper' || meta.enabled;
  const liveEventTradingAllowed = eventStarted && introCountdownDone;
  const canTradeNow = liveCanTrade !== null
    ? liveCanTrade
    : (demoMode
      ? true
      : (competitionContext ? competitionContext.mode === 'paper' : liveEventTradingAllowed));
  void paperStartingBalance;

  const selectedCategory = meta.marketMetadata[selectedPair]?.category;

  const updateOrderPreviewRisk = useCallback((patch: { stopLoss?: number | null; takeProfit?: number | null }) => {
    setTpSlEnabled(true);
    if ('stopLoss' in patch) setStopLossInput(priceInputValue(patch.stopLoss, selectedCategory));
    if ('takeProfit' in patch) setTakeProfitInput(priceInputValue(patch.takeProfit, selectedCategory));
  }, [selectedCategory]);

  const updateOrderPreviewEntry = useCallback((price: number) => {
    if (!Number.isFinite(price) || price <= 0) return;
    setLimitPrice(priceInputValue(price, selectedCategory) || String(price));
  }, [selectedCategory]);

  const orderPanel = (
    <OrderForm
      meta={meta}
      pairs={meta.pairs}
      selectedPair={selectedPair}
      setSelectedPair={setSelectedPair}
      side={side}
      setSide={setSide}
      orderType={orderType}
      setOrderType={setOrderType}
      size={size}
      setSize={setSize}
      limitPrice={limitPrice}
      setLimitPrice={setLimitPrice}
      leverage={leverage}
      setLeverage={setLeverage}
      ticker={ticker}
      player={player}
      busy={busy}
      eventStarted={canTradeNow}
      error={error}
      onSubmit={submitOrder}
      onPreviewChange={setOrderPreview}
      tpSlEnabled={tpSlEnabled}
      setTpSlEnabled={setTpSlEnabled}
      takeProfitInput={takeProfitInput}
      setTakeProfitInput={setTakeProfitInput}
      stopLossInput={stopLossInput}
      setStopLossInput={setStopLossInput}
    />
  );

  const pairLabels = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const p of meta.pairs) {
      const md = meta.marketMetadata?.[p];
      out[p] = md?.name || p;
    }
    return out;
  }, [meta.pairs, meta.marketMetadata]);

  const pairCategories = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const p of meta.pairs) {
      out[p] = meta.marketMetadata?.[p]?.category || 'crypto';
    }
    return out;
  }, [meta.pairs, meta.marketMetadata]);

  const chartPanel = (
    <ChartArea
      pair={selectedPair}
      pairs={meta.pairs}
      pairLabels={pairLabels}
      pairCategories={pairCategories}
      marketMetadata={meta.marketMetadata}
      marketDataSource={meta.marketDataSource}
      tradingViewSymbol={meta.marketMetadata[selectedPair]?.tradingViewSymbol}
      ticker={ticker}
      market={market}
      player={player}
      orderPreview={orderPreview}
      onPreviewRiskChange={updateOrderPreviewRisk}
      onPreviewEntryChange={updateOrderPreviewEntry}
      onUpdateRisk={updateRisk}
      onUpdateOrderRisk={updateOrderRisk}
      onUpdateOrderLimit={updateOrderLimit}
      onCancelOrder={cancelOrder}
      onClosePosition={closePosition}
      onPairChange={(p) => {
        if (meta.pairs.includes(p)) setSelectedPair(p);
      }}
      interval={chartInterval}
      setInterval={setChartInterval}
      isMobile={isMobileViewport}
      chartLiveTickRef={chartLiveTickRef}
    />
  );

  const leaderboardPanel = (
    <BottomTabs
      tab={tab}
      setTab={setTab}
      height={bottomTabsHeight}
      expanded={bottomTabsExpanded}
      onResizeStart={startBottomResize}
      onResizeMove={moveBottomResize}
      onResizeEnd={endBottomResize}
      onToggleExpanded={() => setBottomTabsExpanded((value) => !value)}
      player={player}
      recentTrades={playerTrades}
      ticker={ticker}
      onClosePosition={closePosition}
      onUpdateRisk={updateRisk}
      onCancelOrder={cancelOrder}
      onSelectPair={setSelectedPair}
      busy={busy}
      marketMetadata={meta.marketMetadata}
    />
  );

  const competitionLeaderboardPanel = liveMode ? (
    <LiveRosterLeaderboardPanel
      players={players}
      currentPlayerId={session?.player.id ?? null}
    />
  ) : (
    <CompetitionLeaderboardPanel
      data={leaderboardData}
      currentUserId={competitionContext?.userId}
      currentName={session?.player.name}
      error={leaderboardError}
    />
  );

  return (
    <div
      className="terminal flex h-[100dvh] min-h-[100dvh] flex-col overflow-hidden bg-[#020107] text-[12px] text-[#e0e2ea]"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {!livePaperMode && (
        <div className="m-3 rounded-md border border-[#3a2c08] bg-[#241a05] p-3 text-[12px] text-[#f4b400]">
          {liveMode ? (
            <>Mode paper non actif. Demande à l’admin d’activer le paper trading dans <a className="underline" href="/admin">/admin</a>.</>
          ) : (
            <>Aucune competition active pour ce terminal. Retourne sur <a className="underline" href="/compete">BTF Arena</a> pour rejoindre une arene.</>
          )}
        </div>
      )}

      {competitionContext?.mode === 'real' && (
        <div className="mx-3 mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
          Cette competition est en mode reel. Le terminal reel n est pas encore disponible dans cette version.
        </div>
      )}

      {livePaperMode && !session && bootstrapping && (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="flex flex-col items-center gap-3 text-[#9498a4]">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-[#dc2626] border-t-transparent" />
            <div className="text-[12px] uppercase tracking-[0.25em]">Chargement du terminal</div>
          </div>
        </div>
      )}

      {livePaperMode && !session && !bootstrapping && (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-md rounded-2xl border border-[#231f22] bg-[#0e0c0d] p-7 shadow-2xl shadow-black/40">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.25em] text-[#dc2626]">Acces requis</div>
            <h2 className="font-rajdhani text-3xl font-bold text-white">
              {liveMode ? 'Terminal BTF Live' : 'Terminal de competition'}
            </h2>
            <p className="mt-3 text-[13px] text-[#9498a4]">
              {liveMode
                ? 'Le terminal Live est reserve aux traders inscrits au roster de l\'evenement. Saisis ton code admin pour entrer.'
                : 'Le terminal de trading est reserve aux joueurs inscrits a une competition. Connecte-toi sur la BTF Arena pour rejoindre une arene.'}
            </p>
            {error && <div className="mt-4 text-[12px] text-[#fda4af]">{error}</div>}
            <a
              href={liveMode ? '/trader' : '/compete'}
              className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-[#dc2626] py-3 text-[13px] font-bold uppercase tracking-[0.18em] text-white transition-transform hover:scale-[1.01]"
            >
              {liveMode ? 'Saisir mon code' : 'Aller sur BTF Arena'}
            </a>
          </div>
        </div>
      )}

      {liveMode && session && (
        <LiveEventTraderOverlay
          trader={session.player}
          eventStarted={eventStarted}
          eventStartTime={eventStartTime}
        />
      )}

      {livePaperMode && session && (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-2 pb-2 sm:p-3">
          <TopBar
            player={player}
            trader={session.player}
            competition={competitionContext}
            liveMode={liveMode}
            onLogout={logout}
          />

          <div className="flex min-h-0 flex-1 flex-col lg:hidden">
            {mobileTab === 'orders' && (
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-2">
                {orderPanel}
                {/* Positions / Ordres en attente / Historique : visibles en
                    scrollant sous le formulaire d'ordre, comme sur desktop. */}
                <BottomTabs
                  tab={tab}
                  setTab={setTab}
                  height={bottomTabsHeight}
                  expanded={false}
                  mobileMode
                  onResizeStart={startBottomResize}
                  onResizeMove={moveBottomResize}
                  onResizeEnd={endBottomResize}
                  onToggleExpanded={() => setBottomTabsExpanded((value) => !value)}
                  player={player}
                  recentTrades={playerTrades}
                  ticker={ticker}
                  onClosePosition={closePosition}
                  onUpdateRisk={updateRisk}
                  onCancelOrder={cancelOrder}
                  onSelectPair={setSelectedPair}
                  busy={busy}
                  marketMetadata={meta.marketMetadata}
                />
              </div>
            )}
            {mobileTab === 'chart' && (
              <div className="flex min-h-[calc(100dvh-196px)] flex-1">
                {chartPanel}
              </div>
            )}
            {mobileTab === 'leaderboard' && (
              competitionLeaderboardPanel
            )}
          </div>

          <div className="grid shrink-0 grid-cols-3 gap-1 rounded-2xl border border-[#241e30] bg-[#0d0914] p-1 lg:hidden">
            {[
              { id: 'orders' as const, label: 'Ordres' },
              { id: 'chart' as const, label: 'Graphique' },
              { id: 'leaderboard' as const, label: 'Leaderboard' },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setMobileTab(item.id)}
                className={`h-10 rounded-xl text-[11px] font-bold transition-colors ${
                  mobileTab === item.id
                    ? 'bg-[#dc2626] text-white shadow-[0_10px_30px_-18px_rgba(220,38,38,0.9)]'
                    : 'text-[#8f899e] hover:bg-[#171320] hover:text-white'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="hidden min-h-0 flex-1 flex-col gap-2 lg:flex">
            {!bottomTabsExpanded && (
              <div className="flex min-h-0 flex-1 gap-3">
                {orderPanel}
                {chartPanel}
              </div>
            )}

            {leaderboardPanel}
          </div>
        </div>
      )}
    </div>
  );
}
