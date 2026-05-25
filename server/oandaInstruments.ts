export interface OandaPairMapping {
  pair: string;
  instrument: string;
  /** When true, display price = 1 / OANDA price (e.g. JPY/USD from USD_JPY). */
  invert?: boolean;
}

/** Single source of truth: BTF pair → OANDA v20 instrument name. */
export const OANDA_TRADFI_PAIRS: OandaPairMapping[] = [
  // Actions (US CFD)
  { pair: 'TSLA/USD', instrument: 'TSLA_USD' },
  { pair: 'GOOGL/USD', instrument: 'GOOGL_USD' },
  { pair: 'AAPL/USD', instrument: 'AAPL_USD' },
  { pair: 'MSFT/USD', instrument: 'MSFT_USD' },
  { pair: 'NVDA/USD', instrument: 'NVDA_USD' },
  { pair: 'MSTR/USD', instrument: 'MSTR_USD' },
  { pair: 'META/USD', instrument: 'META_USD' },
  { pair: 'AMZN/USD', instrument: 'AMZN_USD' },
  { pair: 'AMD/USD', instrument: 'AMD_USD' },
  { pair: 'INTC/USD', instrument: 'INTC_USD' },
  { pair: 'COIN/USD', instrument: 'COIN_USD' },
  { pair: 'BABA/USD', instrument: 'BABA_USD' },
  { pair: 'NFLX/USD', instrument: 'NFLX_USD' },
  { pair: 'ORCL/USD', instrument: 'ORCL_USD' },
  { pair: 'PLTR/USD', instrument: 'PLTR_USD' },
  { pair: 'HOOD/USD', instrument: 'HOOD_USD' },
  { pair: 'GME/USD', instrument: 'GME_USD' },
  { pair: 'COST/USD', instrument: 'COST_USD' },
  { pair: 'LLY/USD', instrument: 'LLY_USD' },
  { pair: 'TSM/USD', instrument: 'TSM_USD' },
  { pair: 'MU/USD', instrument: 'MU_USD' },
  // Indices
  { pair: 'SP500/USD', instrument: 'SPX500_USD' },
  { pair: 'JP225/USD', instrument: 'JP225_USD' },
  { pair: 'KR200/USD', instrument: 'KR200_USD' },
  { pair: 'DXY/USD', instrument: 'DXY_USD' },
  { pair: 'VIX/USD', instrument: 'VIX_USD' },
  { pair: 'EWJ/USD', instrument: 'EWJ_USD' },
  { pair: 'EWY/USD', instrument: 'EWY_USD' },
  { pair: 'EWZ/USD', instrument: 'EWZ_USD' },
  // Commodities
  { pair: 'GOLD/USD', instrument: 'XAU_USD' },
  { pair: 'SILVER/USD', instrument: 'XAG_USD' },
  { pair: 'COPPER/USD', instrument: 'XCU_USD' },
  { pair: 'ALUMINIUM/USD', instrument: 'ALUMINIUM_USD' },
  { pair: 'BRENTOIL/USD', instrument: 'BCO_USD' },
  { pair: 'NATGAS/USD', instrument: 'NATGAS_USD' },
  { pair: 'CORN/USD', instrument: 'CORN_USD' },
  { pair: 'WHEAT/USD', instrument: 'WHEAT_USD' },
  { pair: 'URANIUM/USD', instrument: 'URANIUM_USD' },
  { pair: 'PALLADIUM/USD', instrument: 'XPD_USD' },
  { pair: 'PLATINUM/USD', instrument: 'XPT_USD' },
  // Forex
  { pair: 'EUR/USD', instrument: 'EUR_USD' },
  { pair: 'JPY/USD', instrument: 'USD_JPY', invert: true },
  { pair: 'KRW/USD', instrument: 'USD_KRW', invert: true },
];

export const OANDA_PAIR_MAP = new Map(OANDA_TRADFI_PAIRS.map((item) => [item.pair, item]));
export const OANDA_INSTRUMENT_MAP = new Map(OANDA_TRADFI_PAIRS.map((item) => [item.instrument, item]));

export function getOandaMapping(pair: string): OandaPairMapping | undefined {
  return OANDA_PAIR_MAP.get(pair);
}
