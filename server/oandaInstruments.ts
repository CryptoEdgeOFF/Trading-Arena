export interface OandaPairMapping {
  pair: string;
  instrument: string;
  /** Hyperliquid xyz symbol used when OANDA instrument is unavailable on this account. */
  hyperliquidSymbol: string;
  /** When true, display price = 1 / OANDA price (e.g. JPY/USD from USD_JPY). */
  invert?: boolean;
}

/** Single source of truth: BTF pair → OANDA v20 instrument name. */
export const OANDA_TRADFI_PAIRS: OandaPairMapping[] = [
  // Actions (US CFD)
  { pair: 'TSLA/USD', instrument: 'TSLA_USD', hyperliquidSymbol: 'xyz:TSLA' },
  { pair: 'GOOGL/USD', instrument: 'GOOGL_USD', hyperliquidSymbol: 'xyz:GOOGL' },
  { pair: 'AAPL/USD', instrument: 'AAPL_USD', hyperliquidSymbol: 'xyz:AAPL' },
  { pair: 'MSFT/USD', instrument: 'MSFT_USD', hyperliquidSymbol: 'xyz:MSFT' },
  { pair: 'NVDA/USD', instrument: 'NVDA_USD', hyperliquidSymbol: 'xyz:NVDA' },
  { pair: 'MSTR/USD', instrument: 'MSTR_USD', hyperliquidSymbol: 'xyz:MSTR' },
  { pair: 'META/USD', instrument: 'META_USD', hyperliquidSymbol: 'xyz:META' },
  { pair: 'AMZN/USD', instrument: 'AMZN_USD', hyperliquidSymbol: 'xyz:AMZN' },
  { pair: 'AMD/USD', instrument: 'AMD_USD', hyperliquidSymbol: 'xyz:AMD' },
  { pair: 'INTC/USD', instrument: 'INTC_USD', hyperliquidSymbol: 'xyz:INTC' },
  { pair: 'COIN/USD', instrument: 'COIN_USD', hyperliquidSymbol: 'xyz:COIN' },
  { pair: 'BABA/USD', instrument: 'BABA_USD', hyperliquidSymbol: 'xyz:BABA' },
  { pair: 'NFLX/USD', instrument: 'NFLX_USD', hyperliquidSymbol: 'xyz:NFLX' },
  { pair: 'ORCL/USD', instrument: 'ORCL_USD', hyperliquidSymbol: 'xyz:ORCL' },
  { pair: 'PLTR/USD', instrument: 'PLTR_USD', hyperliquidSymbol: 'xyz:PLTR' },
  { pair: 'HOOD/USD', instrument: 'HOOD_USD', hyperliquidSymbol: 'xyz:HOOD' },
  { pair: 'GME/USD', instrument: 'GME_USD', hyperliquidSymbol: 'xyz:GME' },
  { pair: 'COST/USD', instrument: 'COST_USD', hyperliquidSymbol: 'xyz:COST' },
  { pair: 'LLY/USD', instrument: 'LLY_USD', hyperliquidSymbol: 'xyz:LLY' },
  { pair: 'TSM/USD', instrument: 'TSM_USD', hyperliquidSymbol: 'xyz:TSM' },
  { pair: 'MU/USD', instrument: 'MU_USD', hyperliquidSymbol: 'xyz:MU' },
  // Indices
  { pair: 'SP500/USD', instrument: 'SPX500_USD', hyperliquidSymbol: 'xyz:SP500' },
  { pair: 'JP225/USD', instrument: 'JP225_USD', hyperliquidSymbol: 'xyz:JP225' },
  { pair: 'KR200/USD', instrument: 'KR200_USD', hyperliquidSymbol: 'xyz:KR200' },
  { pair: 'DXY/USD', instrument: 'DXY_USD', hyperliquidSymbol: 'xyz:DXY' },
  { pair: 'VIX/USD', instrument: 'VIX_USD', hyperliquidSymbol: 'xyz:VIX' },
  { pair: 'EWJ/USD', instrument: 'EWJ_USD', hyperliquidSymbol: 'xyz:EWJ' },
  { pair: 'EWY/USD', instrument: 'EWY_USD', hyperliquidSymbol: 'xyz:EWY' },
  { pair: 'EWZ/USD', instrument: 'EWZ_USD', hyperliquidSymbol: 'xyz:EWZ' },
  // Commodities
  { pair: 'GOLD/USD', instrument: 'XAU_USD', hyperliquidSymbol: 'xyz:GOLD' },
  { pair: 'SILVER/USD', instrument: 'XAG_USD', hyperliquidSymbol: 'xyz:SILVER' },
  { pair: 'COPPER/USD', instrument: 'XCU_USD', hyperliquidSymbol: 'xyz:COPPER' },
  { pair: 'ALUMINIUM/USD', instrument: 'ALUMINIUM_USD', hyperliquidSymbol: 'xyz:ALUMINIUM' },
  { pair: 'BRENTOIL/USD', instrument: 'BCO_USD', hyperliquidSymbol: 'xyz:BRENTOIL' },
  { pair: 'NATGAS/USD', instrument: 'NATGAS_USD', hyperliquidSymbol: 'xyz:NATGAS' },
  { pair: 'CORN/USD', instrument: 'CORN_USD', hyperliquidSymbol: 'xyz:CORN' },
  { pair: 'WHEAT/USD', instrument: 'WHEAT_USD', hyperliquidSymbol: 'xyz:WHEAT' },
  { pair: 'URANIUM/USD', instrument: 'URANIUM_USD', hyperliquidSymbol: 'xyz:URANIUM' },
  { pair: 'PALLADIUM/USD', instrument: 'XPD_USD', hyperliquidSymbol: 'xyz:PALLADIUM' },
  { pair: 'PLATINUM/USD', instrument: 'XPT_USD', hyperliquidSymbol: 'xyz:PLATINUM' },
  // Forex — OANDA when available, Hyperliquid fallback otherwise
  { pair: 'EUR/USD', instrument: 'EUR_USD', hyperliquidSymbol: 'xyz:EUR' },
  { pair: 'JPY/USD', instrument: 'USD_JPY', hyperliquidSymbol: 'xyz:JPY', invert: true },
  { pair: 'KRW/USD', instrument: 'USD_KRW', hyperliquidSymbol: 'xyz:KRW', invert: true },
];

export const OANDA_PAIR_MAP = new Map(OANDA_TRADFI_PAIRS.map((item) => [item.pair, item]));
export const OANDA_INSTRUMENT_MAP = new Map(OANDA_TRADFI_PAIRS.map((item) => [item.instrument, item]));

export function getOandaMapping(pair: string): OandaPairMapping | undefined {
  return OANDA_PAIR_MAP.get(pair);
}

export function getHyperliquidTradfiSymbol(pair: string): string | null {
  return OANDA_PAIR_MAP.get(pair)?.hyperliquidSymbol ?? null;
}
