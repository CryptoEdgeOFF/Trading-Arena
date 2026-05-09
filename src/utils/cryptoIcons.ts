const CDN = 'https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons@1a63530be6e374711a8554f31b17e4cb92c25fa5/128/color';

const SYMBOL_MAP: Record<string, string> = {
  BTCUSD: 'btc',
  BTCUSDT: 'btc',
  ETHUSD: 'eth',
  ETHUSDT: 'eth',
  SOLUSD: 'sol',
  SOLUSDT: 'sol',
  XRPUSD: 'xrp',
  XRPUSDT: 'xrp',
  DOGEUSD: 'doge',
  DOGEUSDT: 'doge',
  ADAUSD: 'ada',
  ADAUSDT: 'ada',
  DOTUSD: 'dot',
  DOTUSDT: 'dot',
  LINKUSD: 'link',
  LINKUSDT: 'link',
  AVAXUSD: 'avax',
  AVAXUSDT: 'avax',
  MATICUSD: 'matic',
  MATICUSDT: 'matic',
  ATOMUSD: 'atom',
  ATOMUSDT: 'atom',
  UNIUSD: 'uni',
  UNIUSDT: 'uni',
  LTCUSD: 'ltc',
  LTCUSDT: 'ltc',
  BCHUSD: 'bch',
  BCHUSDT: 'bch',
  NEARUSD: 'near',
  NEARUSDT: 'near',
  ARBUSD: 'arb',
  ARBUSDT: 'arb',
  OPUSD: 'op',
  OPUSDT: 'op',
  FILUSD: 'fil',
  FILUSDT: 'fil',
  APTUSD: 'apt',
  APTUSDT: 'apt',
  PEPEUSD: 'pepe',
  PEPEUSDT: 'pepe',
  SHIBUSD: 'shib',
  SHIBUSDT: 'shib',
  BNBUSD: 'bnb',
  BNBUSDT: 'bnb',
  TRXUSD: 'trx',
  TRXUSDT: 'trx',
  TONUSD: 'ton',
  TONUSDT: 'ton',
  SUIUSD: 'sui',
  SUIUSDT: 'sui',
};

export function getCryptoIconUrl(pair: string): string | null {
  const clean = pair.replace(/\//g, '').toUpperCase();
  const symbol = SYMBOL_MAP[clean];
  if (symbol) return `${CDN}/${symbol}.png`;

  const base = clean.replace(/USD[T]?$/, '').toLowerCase();
  if (base.length >= 2 && base.length <= 5) {
    return `${CDN}/${base}.png`;
  }
  return null;
}
