import { Pool } from 'pg';
import { getOandaMapping } from './oandaInstruments.js';

export interface MarketMetadata {
  pair: string;
  base: string;
  quote: string;
  name: string;
  coingeckoId: string;
  imageUrl: string | null;
  krakenSymbol: string;
  category?: 'crypto' | 'actions' | 'indices' | 'commodities' | 'forex';
  source?: 'kraken_futures' | 'hyperliquid_perp' | 'hyperliquid_spot' | 'oanda';
  sourceSymbol?: string;
  tradingViewSymbol?: string | null;
  sortOrder: number;
  enabled: boolean;
}

export const STATIC_MARKET_METADATA: MarketMetadata[] = [
  { pair: 'BTC/USD', base: 'BTC', quote: 'USD', name: 'Bitcoin', coingeckoId: 'bitcoin', imageUrl: null, krakenSymbol: 'PF_XBTUSD', sortOrder: 1, enabled: true },
  { pair: 'ETH/USD', base: 'ETH', quote: 'USD', name: 'Ethereum', coingeckoId: 'ethereum', imageUrl: null, krakenSymbol: 'PF_ETHUSD', sortOrder: 2, enabled: true },
  { pair: 'XRP/USD', base: 'XRP', quote: 'USD', name: 'Ripple', coingeckoId: 'ripple', imageUrl: null, krakenSymbol: 'PF_XRPUSD', sortOrder: 3, enabled: true },
  { pair: 'BNB/USD', base: 'BNB', quote: 'USD', name: 'BNB', coingeckoId: 'binancecoin', imageUrl: null, krakenSymbol: 'PF_BNBUSD', sortOrder: 4, enabled: true },
  { pair: 'SOL/USD', base: 'SOL', quote: 'USD', name: 'Solana', coingeckoId: 'solana', imageUrl: null, krakenSymbol: 'PF_SOLUSD', sortOrder: 5, enabled: true },
  { pair: 'DOGE/USD', base: 'DOGE', quote: 'USD', name: 'Dogecoin', coingeckoId: 'dogecoin', imageUrl: null, krakenSymbol: 'PF_DOGEUSD', sortOrder: 6, enabled: true },
  { pair: 'ADA/USD', base: 'ADA', quote: 'USD', name: 'Cardano', coingeckoId: 'cardano', imageUrl: null, krakenSymbol: 'PF_ADAUSD', sortOrder: 7, enabled: true },
  { pair: 'TRX/USD', base: 'TRX', quote: 'USD', name: 'Tron', coingeckoId: 'tron', imageUrl: null, krakenSymbol: 'PF_TRXUSD', sortOrder: 8, enabled: true },
  { pair: 'LINK/USD', base: 'LINK', quote: 'USD', name: 'Chainlink', coingeckoId: 'chainlink', imageUrl: null, krakenSymbol: 'PF_LINKUSD', sortOrder: 9, enabled: true },
  { pair: 'AVAX/USD', base: 'AVAX', quote: 'USD', name: 'Avalanche', coingeckoId: 'avalanche-2', imageUrl: null, krakenSymbol: 'PF_AVAXUSD', sortOrder: 10, enabled: true },
  { pair: 'XLM/USD', base: 'XLM', quote: 'USD', name: 'Stellar', coingeckoId: 'stellar', imageUrl: null, krakenSymbol: 'PF_XLMUSD', sortOrder: 11, enabled: true },
  { pair: 'BCH/USD', base: 'BCH', quote: 'USD', name: 'Bitcoin Cash', coingeckoId: 'bitcoin-cash', imageUrl: null, krakenSymbol: 'PF_BCHUSD', sortOrder: 12, enabled: true },
  { pair: 'DOT/USD', base: 'DOT', quote: 'USD', name: 'Polkadot', coingeckoId: 'polkadot', imageUrl: null, krakenSymbol: 'PF_DOTUSD', sortOrder: 13, enabled: true },
  { pair: 'LTC/USD', base: 'LTC', quote: 'USD', name: 'Litecoin', coingeckoId: 'litecoin', imageUrl: null, krakenSymbol: 'PF_LTCUSD', sortOrder: 14, enabled: true },
  { pair: 'SUI/USD', base: 'SUI', quote: 'USD', name: 'Sui', coingeckoId: 'sui', imageUrl: null, krakenSymbol: 'PF_SUIUSD', sortOrder: 15, enabled: true },
  { pair: 'HBAR/USD', base: 'HBAR', quote: 'USD', name: 'Hedera', coingeckoId: 'hedera-hashgraph', imageUrl: null, krakenSymbol: 'PF_HBARUSD', sortOrder: 16, enabled: true },
  { pair: 'TON/USD', base: 'TON', quote: 'USD', name: 'Toncoin', coingeckoId: 'the-open-network', imageUrl: null, krakenSymbol: 'PF_TONUSD', sortOrder: 17, enabled: true },
  { pair: 'SHIB/USD', base: 'SHIB', quote: 'USD', name: 'Shiba Inu', coingeckoId: 'shiba-inu', imageUrl: null, krakenSymbol: 'PF_SHIBUSD', sortOrder: 18, enabled: true },
  { pair: 'UNI/USD', base: 'UNI', quote: 'USD', name: 'Uniswap', coingeckoId: 'uniswap', imageUrl: null, krakenSymbol: 'PF_UNIUSD', sortOrder: 19, enabled: true },
  { pair: 'AAVE/USD', base: 'AAVE', quote: 'USD', name: 'Aave', coingeckoId: 'aave', imageUrl: null, krakenSymbol: 'PF_AAVEUSD', sortOrder: 20, enabled: true },
  { pair: 'NEAR/USD', base: 'NEAR', quote: 'USD', name: 'Near Protocol', coingeckoId: 'near', imageUrl: null, krakenSymbol: 'PF_NEARUSD', sortOrder: 21, enabled: true },
  { pair: 'APT/USD', base: 'APT', quote: 'USD', name: 'Aptos', coingeckoId: 'aptos', imageUrl: null, krakenSymbol: 'PF_APTUSD', sortOrder: 22, enabled: true },
  { pair: 'ICP/USD', base: 'ICP', quote: 'USD', name: 'Internet Computer', coingeckoId: 'internet-computer', imageUrl: null, krakenSymbol: 'PF_ICPUSD', sortOrder: 23, enabled: true },
  { pair: 'ETC/USD', base: 'ETC', quote: 'USD', name: 'Ethereum Classic', coingeckoId: 'ethereum-classic', imageUrl: null, krakenSymbol: 'PF_ETCUSD', sortOrder: 24, enabled: true },
  { pair: 'POL/USD', base: 'POL', quote: 'USD', name: 'Polygon', coingeckoId: 'polygon-ecosystem-token', imageUrl: null, krakenSymbol: 'PF_POLUSD', sortOrder: 25, enabled: true },
  { pair: 'FET/USD', base: 'FET', quote: 'USD', name: 'Fetch.ai', coingeckoId: 'fetch-ai', imageUrl: null, krakenSymbol: 'PF_FETUSD', sortOrder: 26, enabled: true },
  { pair: 'RENDER/USD', base: 'RENDER', quote: 'USD', name: 'Render', coingeckoId: 'render-token', imageUrl: null, krakenSymbol: 'PF_RENDERUSD', sortOrder: 27, enabled: true },
  { pair: 'ONDO/USD', base: 'ONDO', quote: 'USD', name: 'Ondo', coingeckoId: 'ondo-finance', imageUrl: null, krakenSymbol: 'PF_ONDOUSD', sortOrder: 28, enabled: true },
  { pair: 'FIL/USD', base: 'FIL', quote: 'USD', name: 'Filecoin', coingeckoId: 'filecoin', imageUrl: null, krakenSymbol: 'PF_FILUSD', sortOrder: 29, enabled: true },
  { pair: 'ARB/USD', base: 'ARB', quote: 'USD', name: 'Arbitrum', coingeckoId: 'arbitrum', imageUrl: null, krakenSymbol: 'PF_ARBUSD', sortOrder: 30, enabled: true },
  { pair: 'ATOM/USD', base: 'ATOM', quote: 'USD', name: 'Cosmos', coingeckoId: 'cosmos', imageUrl: null, krakenSymbol: 'PF_ATOMUSD', sortOrder: 31, enabled: true },
  { pair: 'OP/USD', base: 'OP', quote: 'USD', name: 'Optimism', coingeckoId: 'optimism', imageUrl: null, krakenSymbol: 'PF_OPUSD', sortOrder: 32, enabled: true },
  { pair: 'INJ/USD', base: 'INJ', quote: 'USD', name: 'Injective', coingeckoId: 'injective-protocol', imageUrl: null, krakenSymbol: 'PF_INJUSD', sortOrder: 33, enabled: true },
  { pair: 'WLD/USD', base: 'WLD', quote: 'USD', name: 'Worldcoin', coingeckoId: 'worldcoin-wld', imageUrl: null, krakenSymbol: 'PF_WLDUSD', sortOrder: 34, enabled: true },
  { pair: 'SEI/USD', base: 'SEI', quote: 'USD', name: 'Sei', coingeckoId: 'sei-network', imageUrl: null, krakenSymbol: 'PF_SEIUSD', sortOrder: 35, enabled: true },
  { pair: 'IMX/USD', base: 'IMX', quote: 'USD', name: 'Immutable', coingeckoId: 'immutable-x', imageUrl: null, krakenSymbol: 'PF_IMXUSD', sortOrder: 36, enabled: true },
  { pair: 'GRT/USD', base: 'GRT', quote: 'USD', name: 'The Graph', coingeckoId: 'the-graph', imageUrl: null, krakenSymbol: 'PF_GRTUSD', sortOrder: 37, enabled: true },
  { pair: 'ALGO/USD', base: 'ALGO', quote: 'USD', name: 'Algorand', coingeckoId: 'algorand', imageUrl: null, krakenSymbol: 'PF_ALGOUSD', sortOrder: 38, enabled: true },
  { pair: 'SAND/USD', base: 'SAND', quote: 'USD', name: 'The Sandbox', coingeckoId: 'the-sandbox', imageUrl: null, krakenSymbol: 'PF_SANDUSD', sortOrder: 39, enabled: true },
  { pair: 'MANA/USD', base: 'MANA', quote: 'USD', name: 'Decentraland', coingeckoId: 'decentraland', imageUrl: null, krakenSymbol: 'PF_MANAUSD', sortOrder: 40, enabled: true },
  { pair: 'QNT/USD', base: 'QNT', quote: 'USD', name: 'Quant', coingeckoId: 'quant-network', imageUrl: null, krakenSymbol: 'PF_QNTUSD', sortOrder: 41, enabled: true },
  { pair: 'STX/USD', base: 'STX', quote: 'USD', name: 'Stacks', coingeckoId: 'blockstack', imageUrl: null, krakenSymbol: 'PF_STXUSD', sortOrder: 42, enabled: true },
  { pair: 'LDO/USD', base: 'LDO', quote: 'USD', name: 'Lido DAO', coingeckoId: 'lido-dao', imageUrl: null, krakenSymbol: 'PF_LDOUSD', sortOrder: 43, enabled: true },
  { pair: 'RUNE/USD', base: 'RUNE', quote: 'USD', name: 'Thorchain', coingeckoId: 'thorchain', imageUrl: null, krakenSymbol: 'PF_RUNEUSD', sortOrder: 44, enabled: true },
  { pair: 'APE/USD', base: 'APE', quote: 'USD', name: 'ApeCoin', coingeckoId: 'apecoin', imageUrl: null, krakenSymbol: 'PF_APEUSD', sortOrder: 45, enabled: true },
  { pair: 'PENDLE/USD', base: 'PENDLE', quote: 'USD', name: 'Pendle', coingeckoId: 'pendle', imageUrl: null, krakenSymbol: 'PF_PENDLEUSD', sortOrder: 46, enabled: true },
  { pair: 'TIA/USD', base: 'TIA', quote: 'USD', name: 'Celestia', coingeckoId: 'celestia', imageUrl: null, krakenSymbol: 'PF_TIAUSD', sortOrder: 47, enabled: true },
  { pair: 'JUP/USD', base: 'JUP', quote: 'USD', name: 'Jupiter', coingeckoId: 'jupiter-exchange-solana', imageUrl: null, krakenSymbol: 'PF_JUPUSD', sortOrder: 48, enabled: true },
  { pair: 'PYTH/USD', base: 'PYTH', quote: 'USD', name: 'Pyth Network', coingeckoId: 'pyth-network', imageUrl: null, krakenSymbol: 'PF_PYTHUSD', sortOrder: 49, enabled: true },
  { pair: 'BONK/USD', base: 'BONK', quote: 'USD', name: 'Bonk', coingeckoId: 'bonk', imageUrl: null, krakenSymbol: 'PF_BONKUSD', sortOrder: 50, enabled: true },
  { pair: 'TSLA/USD', base: 'TSLA', quote: 'USD', name: 'Tesla', coingeckoId: '', imageUrl: 'https://logo.clearbit.com/tesla.com', krakenSymbol: '', category: 'actions', source: 'hyperliquid_spot', sourceSymbol: 'xyz:TSLA', tradingViewSymbol: 'NASDAQ:TSLA', sortOrder: 51, enabled: true },
  { pair: 'GOOGL/USD', base: 'GOOGL', quote: 'USD', name: 'Alphabet', coingeckoId: '', imageUrl: 'https://logo.clearbit.com/abc.xyz', krakenSymbol: '', category: 'actions', source: 'hyperliquid_spot', sourceSymbol: 'xyz:GOOGL', tradingViewSymbol: 'NASDAQ:GOOGL', sortOrder: 52, enabled: true },
  { pair: 'AAPL/USD', base: 'AAPL', quote: 'USD', name: 'Apple', coingeckoId: '', imageUrl: 'https://logo.clearbit.com/apple.com', krakenSymbol: '', category: 'actions', source: 'hyperliquid_spot', sourceSymbol: 'xyz:AAPL', tradingViewSymbol: 'NASDAQ:AAPL', sortOrder: 53, enabled: true },
  { pair: 'MSFT/USD', base: 'MSFT', quote: 'USD', name: 'Microsoft', coingeckoId: '', imageUrl: 'https://logo.clearbit.com/microsoft.com', krakenSymbol: '', category: 'actions', source: 'hyperliquid_spot', sourceSymbol: 'xyz:MSFT', tradingViewSymbol: 'NASDAQ:MSFT', sortOrder: 54, enabled: true },
  { pair: 'NVDA/USD', base: 'NVDA', quote: 'USD', name: 'NVIDIA', coingeckoId: '', imageUrl: 'https://logo.clearbit.com/nvidia.com', krakenSymbol: '', category: 'actions', source: 'hyperliquid_spot', sourceSymbol: 'xyz:NVDA', tradingViewSymbol: 'NASDAQ:NVDA', sortOrder: 55, enabled: true },
  { pair: 'MSTR/USD', base: 'MSTR', quote: 'USD', name: 'Strategy', coingeckoId: '', imageUrl: 'https://logo.clearbit.com/microstrategy.com', krakenSymbol: '', category: 'actions', source: 'hyperliquid_spot', sourceSymbol: 'xyz:MSTR', tradingViewSymbol: 'NASDAQ:MSTR', sortOrder: 56, enabled: true },
  { pair: 'META/USD', base: 'META', quote: 'USD', name: 'Meta Platforms', coingeckoId: '', imageUrl: 'https://logo.clearbit.com/meta.com', krakenSymbol: '', category: 'actions', source: 'hyperliquid_spot', sourceSymbol: 'xyz:META', tradingViewSymbol: 'NASDAQ:META', sortOrder: 57, enabled: true },
  { pair: 'AMZN/USD', base: 'AMZN', quote: 'USD', name: 'Amazon', coingeckoId: '', imageUrl: 'https://logo.clearbit.com/amazon.com', krakenSymbol: '', category: 'actions', source: 'hyperliquid_spot', sourceSymbol: 'xyz:AMZN', tradingViewSymbol: 'NASDAQ:AMZN', sortOrder: 58, enabled: true },
  { pair: 'AMD/USD', base: 'AMD', quote: 'USD', name: 'AMD', coingeckoId: '', imageUrl: 'https://logo.clearbit.com/amd.com', krakenSymbol: '', category: 'actions', source: 'hyperliquid_spot', sourceSymbol: 'xyz:AMD', tradingViewSymbol: 'NASDAQ:AMD', sortOrder: 59, enabled: true },
  { pair: 'INTC/USD', base: 'INTC', quote: 'USD', name: 'Intel', coingeckoId: '', imageUrl: 'https://logo.clearbit.com/intel.com', krakenSymbol: '', category: 'actions', source: 'hyperliquid_spot', sourceSymbol: 'xyz:INTC', tradingViewSymbol: 'NASDAQ:INTC', sortOrder: 60, enabled: true },
  { pair: 'COIN/USD', base: 'COIN', quote: 'USD', name: 'Coinbase', coingeckoId: '', imageUrl: 'https://logo.clearbit.com/coinbase.com', krakenSymbol: '', category: 'actions', source: 'hyperliquid_spot', sourceSymbol: 'xyz:COIN', tradingViewSymbol: 'NASDAQ:COIN', sortOrder: 61, enabled: true },
  { pair: 'BABA/USD', base: 'BABA', quote: 'USD', name: 'Alibaba', coingeckoId: '', imageUrl: 'https://logo.clearbit.com/alibaba.com', krakenSymbol: '', category: 'actions', source: 'hyperliquid_spot', sourceSymbol: 'xyz:BABA', tradingViewSymbol: 'NYSE:BABA', sortOrder: 62, enabled: true },
  { pair: 'NFLX/USD', base: 'NFLX', quote: 'USD', name: 'Netflix', coingeckoId: '', imageUrl: 'https://logo.clearbit.com/netflix.com', krakenSymbol: '', category: 'actions', source: 'hyperliquid_spot', sourceSymbol: 'xyz:NFLX', tradingViewSymbol: 'NASDAQ:NFLX', sortOrder: 63, enabled: true },
  { pair: 'ORCL/USD', base: 'ORCL', quote: 'USD', name: 'Oracle', coingeckoId: '', imageUrl: 'https://logo.clearbit.com/oracle.com', krakenSymbol: '', category: 'actions', source: 'hyperliquid_spot', sourceSymbol: 'xyz:ORCL', tradingViewSymbol: 'NYSE:ORCL', sortOrder: 64, enabled: true },
  { pair: 'PLTR/USD', base: 'PLTR', quote: 'USD', name: 'Palantir', coingeckoId: '', imageUrl: 'https://logo.clearbit.com/palantir.com', krakenSymbol: '', category: 'actions', source: 'hyperliquid_spot', sourceSymbol: 'xyz:PLTR', tradingViewSymbol: 'NASDAQ:PLTR', sortOrder: 65, enabled: true },
  { pair: 'HOOD/USD', base: 'HOOD', quote: 'USD', name: 'Robinhood', coingeckoId: '', imageUrl: 'https://logo.clearbit.com/robinhood.com', krakenSymbol: '', category: 'actions', source: 'hyperliquid_spot', sourceSymbol: 'xyz:HOOD', tradingViewSymbol: 'NASDAQ:HOOD', sortOrder: 66, enabled: true },
  { pair: 'GME/USD', base: 'GME', quote: 'USD', name: 'GameStop', coingeckoId: '', imageUrl: 'https://logo.clearbit.com/gamestop.com', krakenSymbol: '', category: 'actions', source: 'hyperliquid_spot', sourceSymbol: 'xyz:GME', tradingViewSymbol: 'NYSE:GME', sortOrder: 67, enabled: true },
  { pair: 'COST/USD', base: 'COST', quote: 'USD', name: 'Costco', coingeckoId: '', imageUrl: 'https://logo.clearbit.com/costco.com', krakenSymbol: '', category: 'actions', source: 'hyperliquid_spot', sourceSymbol: 'xyz:COST', tradingViewSymbol: 'NASDAQ:COST', sortOrder: 68, enabled: true },
  { pair: 'LLY/USD', base: 'LLY', quote: 'USD', name: 'Eli Lilly', coingeckoId: '', imageUrl: 'https://logo.clearbit.com/lilly.com', krakenSymbol: '', category: 'actions', source: 'hyperliquid_spot', sourceSymbol: 'xyz:LLY', tradingViewSymbol: 'NYSE:LLY', sortOrder: 69, enabled: true },
  { pair: 'TSM/USD', base: 'TSM', quote: 'USD', name: 'TSMC', coingeckoId: '', imageUrl: 'https://logo.clearbit.com/tsmc.com', krakenSymbol: '', category: 'actions', source: 'hyperliquid_spot', sourceSymbol: 'xyz:TSM', tradingViewSymbol: 'NYSE:TSM', sortOrder: 70, enabled: true },
  { pair: 'MU/USD', base: 'MU', quote: 'USD', name: 'Micron Technology', coingeckoId: '', imageUrl: 'https://logo.clearbit.com/micron.com', krakenSymbol: '', category: 'actions', source: 'hyperliquid_spot', sourceSymbol: 'xyz:MU', tradingViewSymbol: 'NASDAQ:MU', sortOrder: 71, enabled: true },
  { pair: 'SP500/USD', base: 'SP500', quote: 'USD', name: 'S&P 500', coingeckoId: '', imageUrl: null, krakenSymbol: '', category: 'indices', source: 'hyperliquid_spot', sourceSymbol: 'xyz:SP500', tradingViewSymbol: 'SP:SPX', sortOrder: 91, enabled: true },
  { pair: 'JP225/USD', base: 'JP225', quote: 'USD', name: 'Nikkei 225', coingeckoId: '', imageUrl: null, krakenSymbol: '', category: 'indices', source: 'hyperliquid_spot', sourceSymbol: 'xyz:JP225', tradingViewSymbol: 'TVC:NI225', sortOrder: 92, enabled: true },
  { pair: 'KR200/USD', base: 'KR200', quote: 'USD', name: 'KOSPI 200', coingeckoId: '', imageUrl: null, krakenSymbol: '', category: 'indices', source: 'hyperliquid_spot', sourceSymbol: 'xyz:KR200', tradingViewSymbol: 'KRX:KOSPI200', sortOrder: 93, enabled: true },
  { pair: 'DXY/USD', base: 'DXY', quote: 'USD', name: 'US Dollar Index', coingeckoId: '', imageUrl: null, krakenSymbol: '', category: 'indices', source: 'hyperliquid_spot', sourceSymbol: 'xyz:DXY', tradingViewSymbol: 'TVC:DXY', sortOrder: 94, enabled: true },
  { pair: 'VIX/USD', base: 'VIX', quote: 'USD', name: 'Volatility Index', coingeckoId: '', imageUrl: null, krakenSymbol: '', category: 'indices', source: 'hyperliquid_spot', sourceSymbol: 'xyz:VIX', tradingViewSymbol: 'CBOE:VIX', sortOrder: 95, enabled: true },
  { pair: 'EWJ/USD', base: 'EWJ', quote: 'USD', name: 'iShares MSCI Japan ETF', coingeckoId: '', imageUrl: null, krakenSymbol: '', category: 'indices', source: 'hyperliquid_spot', sourceSymbol: 'xyz:EWJ', tradingViewSymbol: 'AMEX:EWJ', sortOrder: 96, enabled: true },
  { pair: 'EWY/USD', base: 'EWY', quote: 'USD', name: 'iShares MSCI South Korea ETF', coingeckoId: '', imageUrl: null, krakenSymbol: '', category: 'indices', source: 'hyperliquid_spot', sourceSymbol: 'xyz:EWY', tradingViewSymbol: 'AMEX:EWY', sortOrder: 97, enabled: true },
  { pair: 'EWZ/USD', base: 'EWZ', quote: 'USD', name: 'iShares MSCI Brazil ETF', coingeckoId: '', imageUrl: null, krakenSymbol: '', category: 'indices', source: 'hyperliquid_spot', sourceSymbol: 'xyz:EWZ', tradingViewSymbol: 'AMEX:EWZ', sortOrder: 98, enabled: true },
  { pair: 'GOLD/USD', base: 'GOLD', quote: 'USD', name: 'Gold', coingeckoId: '', imageUrl: null, krakenSymbol: '', category: 'commodities', source: 'hyperliquid_spot', sourceSymbol: 'xyz:GOLD', tradingViewSymbol: 'TVC:GOLD', sortOrder: 121, enabled: true },
  { pair: 'SILVER/USD', base: 'SILVER', quote: 'USD', name: 'Silver', coingeckoId: '', imageUrl: null, krakenSymbol: '', category: 'commodities', source: 'hyperliquid_spot', sourceSymbol: 'xyz:SILVER', tradingViewSymbol: 'TVC:SILVER', sortOrder: 122, enabled: true },
  { pair: 'COPPER/USD', base: 'COPPER', quote: 'USD', name: 'Copper', coingeckoId: '', imageUrl: null, krakenSymbol: '', category: 'commodities', source: 'hyperliquid_spot', sourceSymbol: 'xyz:COPPER', tradingViewSymbol: 'COMEX:HG1!', sortOrder: 123, enabled: true },
  { pair: 'ALUMINIUM/USD', base: 'ALUMINIUM', quote: 'USD', name: 'Aluminium', coingeckoId: '', imageUrl: null, krakenSymbol: '', category: 'commodities', source: 'hyperliquid_spot', sourceSymbol: 'xyz:ALUMINIUM', tradingViewSymbol: 'LME:AH1!', sortOrder: 124, enabled: true },
  { pair: 'BRENTOIL/USD', base: 'BRENTOIL', quote: 'USD', name: 'Brent Oil', coingeckoId: '', imageUrl: null, krakenSymbol: '', category: 'commodities', source: 'hyperliquid_spot', sourceSymbol: 'xyz:BRENTOIL', tradingViewSymbol: 'TVC:UKOIL', sortOrder: 125, enabled: true },
  { pair: 'NATGAS/USD', base: 'NATGAS', quote: 'USD', name: 'Natural Gas', coingeckoId: '', imageUrl: null, krakenSymbol: '', category: 'commodities', source: 'hyperliquid_spot', sourceSymbol: 'xyz:NATGAS', tradingViewSymbol: 'NYMEX:NG1!', sortOrder: 126, enabled: true },
  { pair: 'CORN/USD', base: 'CORN', quote: 'USD', name: 'Corn', coingeckoId: '', imageUrl: null, krakenSymbol: '', category: 'commodities', source: 'hyperliquid_spot', sourceSymbol: 'xyz:CORN', tradingViewSymbol: 'CBOT:ZC1!', sortOrder: 127, enabled: true },
  { pair: 'WHEAT/USD', base: 'WHEAT', quote: 'USD', name: 'Wheat', coingeckoId: '', imageUrl: null, krakenSymbol: '', category: 'commodities', source: 'hyperliquid_spot', sourceSymbol: 'xyz:WHEAT', tradingViewSymbol: 'CBOT:ZW1!', sortOrder: 128, enabled: true },
  { pair: 'URANIUM/USD', base: 'URANIUM', quote: 'USD', name: 'Uranium', coingeckoId: '', imageUrl: null, krakenSymbol: '', category: 'commodities', source: 'hyperliquid_spot', sourceSymbol: 'xyz:URANIUM', tradingViewSymbol: 'COMEX:UX1!', sortOrder: 129, enabled: true },
  { pair: 'PALLADIUM/USD', base: 'PALLADIUM', quote: 'USD', name: 'Palladium', coingeckoId: '', imageUrl: null, krakenSymbol: '', category: 'commodities', source: 'hyperliquid_spot', sourceSymbol: 'xyz:PALLADIUM', tradingViewSymbol: 'NYMEX:PA1!', sortOrder: 130, enabled: true },
  { pair: 'PLATINUM/USD', base: 'PLATINUM', quote: 'USD', name: 'Platinum', coingeckoId: '', imageUrl: null, krakenSymbol: '', category: 'commodities', source: 'hyperliquid_spot', sourceSymbol: 'xyz:PLATINUM', tradingViewSymbol: 'NYMEX:PL1!', sortOrder: 131, enabled: true },
  { pair: 'EUR/USD', base: 'EUR', quote: 'USD', name: 'Euro / US Dollar', coingeckoId: '', imageUrl: null, krakenSymbol: '', category: 'forex', source: 'hyperliquid_spot', sourceSymbol: 'xyz:EUR', tradingViewSymbol: 'FX:EURUSD', sortOrder: 151, enabled: true },
  { pair: 'JPY/USD', base: 'JPY', quote: 'USD', name: 'Japanese Yen / US Dollar', coingeckoId: '', imageUrl: null, krakenSymbol: '', category: 'forex', source: 'hyperliquid_spot', sourceSymbol: 'xyz:JPY', tradingViewSymbol: 'FX_IDC:JPYUSD', sortOrder: 152, enabled: true },
  { pair: 'KRW/USD', base: 'KRW', quote: 'USD', name: 'Korean Won / US Dollar', coingeckoId: '', imageUrl: null, krakenSymbol: '', category: 'forex', source: 'hyperliquid_spot', sourceSymbol: 'xyz:KRW', tradingViewSymbol: 'FX_IDC:KRWUSD', sortOrder: 153, enabled: true },
];

let pool: Pool | null = null;
let ready: Promise<void> | null = null;
let cache: Record<string, MarketMetadata> | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60_000;

function getPool(): Pool | null {
  if (pool) return pool;
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) return null;
  pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  });
  pool.on('error', (err) => {
    console.error('[market metadata pool] idle client error:', err.message || err);
  });
  return pool;
}

export async function ensureMarketMetadataTable(): Promise<void> {
  const db = getPool();
  if (!db) return;
  if (!ready) {
    ready = db.query(`
      create table if not exists market_metadata (
        pair text primary key,
        base text not null,
        quote text not null default 'USD',
        name text not null,
        coingecko_id text not null,
        image_url text,
        kraken_symbol text not null,
        category text not null default 'crypto',
        source text not null default 'kraken_futures',
        source_symbol text,
        tradingview_symbol text,
        sort_order integer not null,
        enabled boolean not null default true,
        updated_at timestamptz not null default now()
      )
    `).then(() => undefined);
    ready = ready.then(async () => {
      await db.query("alter table market_metadata add column if not exists category text not null default 'crypto'");
      await db.query("alter table market_metadata add column if not exists source text not null default 'kraken_futures'");
      await db.query('alter table market_metadata add column if not exists source_symbol text');
      await db.query('alter table market_metadata add column if not exists tradingview_symbol text');
    });
  }
  await ready;
}

function fallbackMetadata(): Record<string, MarketMetadata> {
  return Object.fromEntries(STATIC_MARKET_METADATA.map((item) => [item.pair, withImageFallback(item)]));
}

function svgIcon(label: string, background: string): string {
  const safeLabel = label.slice(0, 5).replace(/[^A-Z0-9]/gi, '').toUpperCase() || 'BTF';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="${background}"/><text x="32" y="39" text-anchor="middle" font-family="Arial, sans-serif" font-size="17" font-weight="700" fill="white">${safeLabel}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function fallbackImageFor(item: MarketMetadata): string | null {
  const category = item.category || 'crypto';
  if (category === 'crypto') return `https://assets.coincap.io/assets/icons/${item.base.toLowerCase()}@2x.png`;
  if (category === 'actions') return item.imageUrl || svgIcon(item.base, '#1d4ed8');
  if (category === 'indices') return svgIcon(item.base, '#7c3aed');
  if (category === 'commodities') return svgIcon(item.base, '#b45309');
  if (category === 'forex') return svgIcon(item.base, '#047857');
  return null;
}

function withImageFallback(item: MarketMetadata): MarketMetadata {
  const oandaMapping = getOandaMapping(item.pair);
  const normalized = oandaMapping
    ? {
        ...item,
        source: 'oanda' as const,
        sourceSymbol: oandaMapping.instrument,
      }
    : item;
  return {
    ...normalized,
    imageUrl: normalized.imageUrl || fallbackImageFor(normalized),
  };
}

export async function getMarketMetadata(pairs: string[]): Promise<Record<string, MarketMetadata>> {
  const db = getPool();
  if (!db) return fallbackMetadata();

  try {
    await ensureMarketMetadataTable();
    const cacheHasImages = cache ? Object.values(cache).some((item) => Boolean(item.imageUrl)) : false;
    const cacheFresh = Date.now() - cacheLoadedAt < CACHE_TTL_MS;
    if (!cache || !cacheFresh || !cacheHasImages) {
      const result = await db.query(`
        select pair, base, quote, name, coingecko_id, image_url, kraken_symbol, category, source, source_symbol, tradingview_symbol, sort_order, enabled
        from market_metadata
        where enabled = true
        order by sort_order asc
      `);
      cache = Object.fromEntries(result.rows.map((row) => [row.pair, withImageFallback({
        pair: row.pair,
        base: row.base,
        quote: row.quote,
        name: row.name,
        coingeckoId: row.coingecko_id,
        imageUrl: row.image_url,
        krakenSymbol: row.kraken_symbol,
        category: row.category,
        source: row.source,
        sourceSymbol: row.source_symbol,
        tradingViewSymbol: row.tradingview_symbol,
        sortOrder: row.sort_order,
        enabled: row.enabled,
      } satisfies MarketMetadata)]));
      cacheLoadedAt = Date.now();
    }

    const fallback = fallbackMetadata();
    return Object.fromEntries(pairs.map((pair) => [pair, cache?.[pair] || fallback[pair]]).filter(([, value]) => Boolean(value)));
  } catch (error) {
    console.error('Market metadata unavailable:', (error as Error).message);
    return fallbackMetadata();
  }
}
