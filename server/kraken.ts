import crypto from 'crypto';

const FUTURES_BASE = 'https://futures.kraken.com';
const SPOT_BASE = 'https://api.kraken.com';

export interface OhlcCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface OhlcQueryOptions {
  from?: number;
  to?: number;
  countBack?: number;
}

const SPOT_PAIR_MAP: Record<string, string> = {
  'BTC/USD': 'XBTUSD',
  'ETH/USD': 'ETHUSD',
  'SOL/USD': 'SOLUSD',
  'XRP/USD': 'XRPUSD',
};

let nonceCounter = Date.now() * 1000;
function nextNonce(): string {
  nonceCounter++;
  return nonceCounter.toString();
}

function getFuturesAuthent(
  endpointPath: string,
  postData: string,
  nonce: string,
  apiSecret: string
): string {
  const concat = postData + nonce + endpointPath;
  const hashDigest = crypto.createHash('sha256').update(concat).digest('binary');
  const secretDecoded = Buffer.from(apiSecret, 'base64');
  const hmacDigest = crypto
    .createHmac('sha512', secretDecoded)
    .update(hashDigest, 'binary')
    .digest('base64');
  return hmacDigest;
}

async function futuresRequest(
  endpoint: string,
  apiKey: string,
  apiSecret: string,
  params: Record<string, string> = {},
  method: 'GET' | 'POST' = 'GET'
): Promise<any> {
  // Sign with /api/v3/... path (legacy format that works with current keys)
  const signPath = `/api/v3/${endpoint}`;
  // Actual URL uses /derivatives/api/v3/...
  const urlPath = `/derivatives/api/v3/${endpoint}`;
  const nonce = nextNonce();
  const postData = new URLSearchParams(params).toString();

  const authent = getFuturesAuthent(signPath, postData, nonce, apiSecret);

  const url =
    method === 'GET' && postData
      ? `${FUTURES_BASE}${urlPath}?${postData}`
      : `${FUTURES_BASE}${urlPath}`;

  const headers: Record<string, string> = {
    APIKey: apiKey,
    Authent: authent,
    Nonce: nonce,
  };

  const fetchOpts: RequestInit = { method, headers };

  if (method === 'POST' && postData) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    fetchOpts.body = postData;
  }

  const res = await fetch(url, fetchOpts);
  const json = await res.json();

  if (json.result !== 'success') {
    const errMsg = json.error || json.errors?.join(', ') || json.result || 'unknown';
    throw new Error(`Kraken Futures: ${errMsg}`);
  }
  return json;
}

export async function getAccounts(
  apiKey: string,
  apiSecret: string
): Promise<any> {
  return futuresRequest('accounts', apiKey, apiSecret);
}

export async function getOpenPositions(
  apiKey: string,
  apiSecret: string
): Promise<any> {
  return futuresRequest('openpositions', apiKey, apiSecret);
}

export async function getFills(
  apiKey: string,
  apiSecret: string,
  lastFillTime?: string
): Promise<any> {
  const params: Record<string, string> = {};
  if (lastFillTime) params.lastFillTime = lastFillTime;
  return futuresRequest('fills', apiKey, apiSecret, params);
}

export async function getTickers(): Promise<Record<string, number>> {
  const stats = await getTickerStats();
  return Object.fromEntries(Object.entries(stats).map(([symbol, ticker]) => [symbol, ticker.markPrice]));
}

export async function getTickerStats(): Promise<Record<string, { markPrice: number; change24h: number | null }>> {
  const url = `${FUTURES_BASE}/derivatives/api/v3/tickers`;
  const res = await fetch(url);
  const json = await res.json();
  const prices: Record<string, { markPrice: number; change24h: number | null }> = {};
  if (json.tickers) {
    for (const t of json.tickers) {
      if (t.symbol && t.markPrice) {
        const change24h = Number(t.change24h);
        prices[t.symbol.toUpperCase()] = {
          markPrice: Number(t.markPrice),
          change24h: Number.isFinite(change24h) ? change24h : null,
        };
      }
    }
  }
  return prices;
}

export async function getOhlcCandles(pair: string, interval = 1): Promise<OhlcCandle[]> {
  const krakenPair = SPOT_PAIR_MAP[pair];
  if (!krakenPair) {
    throw new Error('Pair non supportée pour historique chart');
  }

  const safeInterval = [1, 5, 15, 30, 60, 240, 1440].includes(interval) ? interval : 1;
  const url = `${SPOT_BASE}/0/public/OHLC?pair=${encodeURIComponent(krakenPair)}&interval=${safeInterval}`;
  const res = await fetch(url);
  const json = await res.json();

  if (json.error?.length) {
    throw new Error(`Kraken OHLC: ${json.error.join(', ')}`);
  }

  const result = json.result || {};
  const key = Object.keys(result).find((entry) => entry !== 'last');
  const rows: any[] = key ? result[key] || [] : [];

  return rows
    .map((row) => ({
      time: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
    }))
    .filter((candle) => (
      Number.isFinite(candle.time)
      && Number.isFinite(candle.open)
      && Number.isFinite(candle.high)
      && Number.isFinite(candle.low)
      && Number.isFinite(candle.close)
    ));
}

export async function testConnection(
  apiKey: string,
  apiSecret: string
): Promise<boolean> {
  try {
    const result = await getAccounts(apiKey, apiSecret);
    const accountKeys = Object.keys(result.accounts || {});
    console.log(`[Kraken] Connection OK — accounts: ${accountKeys.join(', ')}`);
    return true;
  } catch (err) {
    console.error('[Kraken] Connection failed:', (err as Error).message);
    return false;
  }
}
