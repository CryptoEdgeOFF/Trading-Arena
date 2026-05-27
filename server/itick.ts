/**
 * Wrapper de l'API iTick (https://docs.itick.org/) — utilisé en source
 * principale pour les paires forex / indices / commodities. Le crypto
 * reste sur Binance avec fallback Hyperliquid (cf. engineCandlesCache).
 *
 * Architecture :
 *   - Un `ItickClusterManager` par asset class (forex / indices / …).
 *     Chaque cluster maintient sa propre connexion WS upstream et émet
 *     les ticks reçus via un EventEmitter.
 *   - Un `ItickFeedRegistry` global qui agrège les managers et expose
 *     une API simple (subscribe / getStatus / on('tick')).
 *
 * Plan iTick pro : 600 calls REST/min, 6 connexions WS, 500 subscriptions.
 */

import WebSocket from 'ws';
import { EventEmitter } from 'node:events';

const BASE_URL = 'https://api0.itick.org';
const DEFAULT_REGION = 'GB';

export type ItickAssetClass = 'forex' | 'indices' | 'crypto' | 'stock';

const ASSET_PATH: Record<ItickAssetClass, string> = {
  forex: 'forex',
  indices: 'indices',
  crypto: 'crypto',
  stock: 'stock',
};

// Le cluster WS dépend du plan. Pour l'instant on utilise les URLs
// `api-free` qui acceptent aussi les tokens pro (testé). Si iTick fournit
// un host dédié pro on pourra le mettre via ITICK_WS_BASE.
function wsUrlFor(asset: ItickAssetClass): string {
  const base = process.env.ITICK_WS_BASE?.trim() || 'wss://api-free.itick.org';
  return `${base}/${ASSET_PATH[asset]}`;
}

export interface ItickTick {
  symbol: string;
  price: number;
  ts: number;
}

export interface ItickKlineRow {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** Map TradingView interval (minutes) → iTick kType. */
const KTYPE_MAP: Record<number, number> = {
  1: 1,
  5: 2,
  15: 3,
  30: 4,
  60: 5,
  1440: 8,
};

export function intervalToKType(intervalMin: number): number | null {
  return KTYPE_MAP[intervalMin] ?? null;
}

function getToken(): string {
  const token = process.env.ITICK_TOKEN?.trim();
  if (!token) {
    throw new Error('ITICK_TOKEN absent (déclare-le dans .env / Railway)');
  }
  return token;
}

async function fetchItick<T = any>(path: string, params: Record<string, string | number>): Promise<T> {
  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  const response = await fetch(url.toString(), {
    headers: {
      accept: 'application/json',
      token: getToken(),
    },
  });
  if (!response.ok) {
    throw new Error(`iTick ${path} HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { code?: number; msg?: string | null; data?: any };
  if (payload?.code !== 0 && payload?.code !== undefined && payload.code !== 200) {
    throw new Error(`iTick ${path} code=${payload.code} msg=${payload.msg ?? ''}`);
  }
  return payload?.data as T;
}

const tickCache = new Map<string, { value: ItickTick; expiresAt: number }>();
const TICK_CACHE_TTL_MS = 250;

export async function getLatestTick(
  code: string,
  asset: ItickAssetClass = 'forex',
  region = DEFAULT_REGION,
): Promise<ItickTick> {
  const cacheKey = `${asset}:${region}:${code}`;
  const cached = tickCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;

  const data = await fetchItick<{ s: string; ld: number; t: number; v?: number }>(
    `/${ASSET_PATH[asset]}/tick`,
    { region, code },
  );
  if (!data || typeof data.ld !== 'number' || typeof data.t !== 'number') {
    throw new Error(`Réponse iTick invalide pour /${ASSET_PATH[asset]}/tick`);
  }
  const tick: ItickTick = {
    symbol: data.s || code,
    price: data.ld,
    ts: data.t,
  };
  tickCache.set(cacheKey, { value: tick, expiresAt: now + TICK_CACHE_TTL_MS });
  return tick;
}

export async function getKline(
  code: string,
  intervalMin: number,
  limit: number,
  endTs?: number,
  asset: ItickAssetClass = 'forex',
  region = DEFAULT_REGION,
): Promise<ItickKlineRow[]> {
  const kType = intervalToKType(intervalMin);
  if (kType == null) {
    throw new Error(`Interval non supporté par iTick: ${intervalMin}m`);
  }
  const params: Record<string, string | number> = {
    region,
    code,
    kType,
    limit: Math.max(1, Math.min(1000, limit)),
  };
  if (endTs && endTs > 0) params.et = endTs;

  const rows = await fetchItick<Array<{ t: number; o: number; h: number; l: number; c: number; v?: number }>>(
    `/${ASSET_PATH[asset]}/kline`,
    params,
  );
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row): ItickKlineRow | null => {
      const time = Number(row?.t);
      const open = Number(row?.o);
      const high = Number(row?.h);
      const low = Number(row?.l);
      const close = Number(row?.c);
      if (
        !Number.isFinite(time) || time <= 0
        || !Number.isFinite(open) || !Number.isFinite(high)
        || !Number.isFinite(low) || !Number.isFinite(close)
      ) {
        return null;
      }
      return {
        time: Math.floor(time / 1000),
        open,
        high,
        low,
        close,
        volume: Number.isFinite(Number(row?.v)) ? Number(row?.v) : undefined,
      };
    })
    .filter((bar): bar is ItickKlineRow => bar !== null)
    .sort((a, b) => a.time - b.time);
}

export function isConfigured(): boolean {
  return Boolean(process.env.ITICK_TOKEN?.trim());
}

/* -------------------------------------------------------------------------- */
/*                              WebSocket upstream                            */
/* -------------------------------------------------------------------------- */

export interface ItickLiveTick {
  symbol: string;
  asset: ItickAssetClass;
  price: number;
  bid?: number;
  ask?: number;
  ts: number;
}

/** iTick exige un keepalive applicatif `{"ac":"ping",...}` au moins
 *  toutes les 60s, sinon le serveur ferme la connexion. On envoie à
 *  30s pour garder une marge confortable. */
const HEARTBEAT_MS = 30_000;
const RECONNECT_MIN_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;
const RATE_LIMIT_COOLDOWN_MIN_MS = 30_000;
const RATE_LIMIT_COOLDOWN_MAX_MS = 5 * 60_000;
const FAST_CLOSE_THRESHOLD_MS = 3_000;

class ItickClusterManager extends EventEmitter {
  readonly asset: ItickAssetClass;
  private ws: WebSocket | null = null;
  private subscribedSymbols = new Set<string>();
  private pendingSubscribeTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private authenticated = false;
  private wantConnected = false;
  private latest = new Map<string, ItickLiveTick>();
  private lastOpenAt = 0;
  private cooldownUntil = 0;
  private lastError = '';
  private intentionalClose = false;
  private rateLimitHits = 0;

  constructor(asset: ItickAssetClass) {
    super();
    this.asset = asset;
  }

  setSymbols(codes: string[]): void {
    const symbols = codes.map((c) => c.trim().toUpperCase()).filter((c) => c.length > 0);
    const sameSymbols = symbols.length === this.subscribedSymbols.size
      && symbols.every((s) => this.subscribedSymbols.has(s));
    if (sameSymbols && this.wantConnected) return;

    this.subscribedSymbols = new Set(symbols);
    this.wantConnected = symbols.length > 0;

    if (this.wantConnected) {
      if (this.ws?.readyState === WebSocket.OPEN && this.authenticated) {
        this.queueSubscribe();
      } else {
        this.scheduleReconnect();
      }
    } else if (this.ws) {
      this.intentionalClose = true;
      try { this.ws.close(); } catch { /* noop */ }
    }
  }

  addSymbols(codes: string[]): void {
    const merged = new Set(this.subscribedSymbols);
    for (const c of codes) {
      const sym = c.trim().toUpperCase();
      if (sym) merged.add(sym);
    }
    this.setSymbols([...merged]);
  }

  getLatest(symbol: string): ItickLiveTick | undefined {
    return this.latest.get(symbol.trim().toUpperCase());
  }

  resetCooldown(): void {
    this.cooldownUntil = 0;
    this.reconnectAttempt = 0;
    this.rateLimitHits = 0;
    this.lastError = '';
    if (this.wantConnected && (!this.ws || this.ws.readyState !== WebSocket.OPEN)) {
      this.connect();
    }
  }

  disconnect(): void {
    this.wantConnected = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    if (this.ws) {
      this.intentionalClose = true;
      try { this.ws.close(); } catch { /* noop */ }
      this.ws = null;
    }
  }

  getStatus() {
    return {
      asset: this.asset,
      connected: this.ws?.readyState === WebSocket.OPEN,
      authenticated: this.authenticated,
      symbols: [...this.subscribedSymbols],
      cooldownRemainingMs: Math.max(0, this.cooldownUntil - Date.now()),
      lastError: this.lastError,
      latest: [...this.latest.entries()].map(([sym, t]) => ({
        symbol: sym,
        price: t.price,
        ageMs: Date.now() - t.ts,
      })),
    };
  }

  private connect(): void {
    if (!this.wantConnected) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    const now = Date.now();
    if (now < this.cooldownUntil) {
      this.scheduleReconnect();
      return;
    }
    let token: string;
    try {
      token = getToken();
    } catch (err) {
      console.warn(`[itickWS:${this.asset}]`, (err as Error).message);
      return;
    }
    this.authenticated = false;
    this.lastOpenAt = 0;
    const url = wsUrlFor(this.asset);
    const ws = new WebSocket(url, { headers: { token } });
    this.ws = ws;

    ws.on('open', () => {
      console.log(`[itickWS:${this.asset}] connecté, en attente auth…`);
      this.lastOpenAt = Date.now();
      this.reconnectAttempt = 0;
      this.startHeartbeat();
    });

    ws.on('message', (raw) => this.handleMessage(raw.toString()));

    ws.on('error', (err) => {
      this.lastError = err.message;
      console.warn(`[itickWS:${this.asset}] error:`, err.message);
    });

    ws.on('unexpected-response', (req, res) => {
      this.lastError = `HTTP ${res.statusCode}`;
      if (res.statusCode === 429) {
        this.rateLimitHits++;
        const cooldown = Math.min(
          RATE_LIMIT_COOLDOWN_MAX_MS,
          RATE_LIMIT_COOLDOWN_MIN_MS * Math.pow(2, this.rateLimitHits - 1),
        );
        this.cooldownUntil = Date.now() + cooldown;
        console.warn(
          `[itickWS:${this.asset}] HTTP 429 (#${this.rateLimitHits}) — cooldown ${Math.round(cooldown / 1000)}s.`,
        );
      } else {
        console.warn(`[itickWS:${this.asset}] HTTP ${res.statusCode}`);
      }
      // CRITIQUE : sur `unexpected-response`, la lib `ws` n'émet PAS
      // l'event `close` automatiquement, donc `scheduleReconnect()` ne
      // serait jamais appelé. On force la cleanup ici pour que le
      // cluster retente après le cooldown.
      try { req.destroy(); } catch { /* noop */ }
      try { ws.terminate(); } catch { /* noop */ }
      this.authenticated = false;
      this.stopHeartbeat();
      this.ws = null;
      if (this.wantConnected) this.scheduleReconnect();
    });

    ws.on('close', (code, reason) => {
      const aliveMs = this.lastOpenAt ? Date.now() - this.lastOpenAt : 0;
      const intentional = this.intentionalClose;
      this.intentionalClose = false;
      console.warn(`[itickWS:${this.asset}] close code=${code} reason=${reason.toString() || 'n/a'} aliveMs=${aliveMs} intentional=${intentional}`);
      if (!intentional && this.lastOpenAt && aliveMs < FAST_CLOSE_THRESHOLD_MS && !this.authenticated) {
        this.cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
        this.lastError = `Cluster a fermé après ${aliveMs}ms (probable refus). Cooldown.`;
      }
      this.authenticated = false;
      this.stopHeartbeat();
      this.ws = null;
      if (this.wantConnected) this.scheduleReconnect();
    });
  }

  private handleMessage(text: string): void {
    let msg: any;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg?.resAc === 'auth' || msg?.ac === 'auth') {
      if (msg.code === 1 || msg.code === 0) {
        this.authenticated = true;
        this.rateLimitHits = 0;
        console.log(`[itickWS:${this.asset}] auth OK`);
        this.queueSubscribe();
      } else {
        console.warn(`[itickWS:${this.asset}] auth refusée :`, msg.msg || msg);
      }
      return;
    }
    if (msg?.resAc === 'subscribe' || msg?.ac === 'subscribe') {
      if (msg.code !== 1 && msg.code !== 0) {
        console.warn(`[itickWS:${this.asset}] subscribe refusée :`, msg.msg || msg);
      }
      return;
    }
    if (msg?.resAc === 'pong' || msg?.ac === 'pong') {
      return;
    }
    // Message d'accueil pré-auth : `{"code":1,"msg":"Connected Successfully"}`.
    // Pas de `data` ni de `resAc`. À ignorer silencieusement.
    if (msg?.code !== undefined && !msg?.data && !msg?.s) {
      return;
    }
    const data = msg?.data && typeof msg.data === 'object' ? msg.data : msg;
    const symbol = String(data?.s || '').toUpperCase();
    if (!symbol) return;
    const last = Number(data?.ld ?? data?.lp ?? data?.c);
    const bid = Number(data?.bp ?? data?.b);
    const ask = Number(data?.ap ?? data?.a);
    const ts = Number(data?.t || Date.now());
    const price = Number.isFinite(last) && last > 0
      ? last
      : (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0
        ? (bid + ask) / 2
        : NaN);
    if (!Number.isFinite(price) || price <= 0) return;
    const tick: ItickLiveTick = {
      symbol,
      asset: this.asset,
      price,
      bid: Number.isFinite(bid) && bid > 0 ? bid : undefined,
      ask: Number.isFinite(ask) && ask > 0 ? ask : undefined,
      ts,
    };
    this.latest.set(symbol, tick);
    this.emit('tick', tick);
  }

  private queueSubscribe(): void {
    if (this.pendingSubscribeTimer) return;
    this.pendingSubscribeTimer = setTimeout(() => {
      this.pendingSubscribeTimer = null;
      this.sendSubscribe();
    }, 50);
  }

  private sendSubscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.authenticated) return;
    if (this.subscribedSymbols.size === 0) return;
    const params = [...this.subscribedSymbols].map((s) => `${s}$${DEFAULT_REGION}`).join(',');
    const msg = { ac: 'subscribe', params, types: 'quote,tick' };
    try {
      this.ws.send(JSON.stringify(msg));
      console.log(`[itickWS:${this.asset}] subscribe →`, params);
    } catch (err) {
      console.warn(`[itickWS:${this.asset}] subscribe send failed:`, (err as Error).message);
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      // iTick attend un keepalive *applicatif* (pas un PING WS natif).
      // cf. https://docs.itick.org/websocket/forex
      const payload = JSON.stringify({ ac: 'ping', params: String(Date.now()) });
      try {
        this.ws.send(payload);
      } catch (err) {
        console.warn(`[itickWS:${this.asset}] heartbeat send failed:`, (err as Error).message);
      }
    }, HEARTBEAT_MS);
    if (typeof this.heartbeatTimer.unref === 'function') this.heartbeatTimer.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const backoff = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * Math.pow(2, this.reconnectAttempt));
    const cooldown = Math.max(0, this.cooldownUntil - Date.now());
    const delay = Math.max(backoff, cooldown);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    if (typeof this.reconnectTimer.unref === 'function') this.reconnectTimer.unref();
  }
}

/**
 * Registry global : 1 manager par cluster. Le serveur n'a qu'à appeler
 * `itickFeed.setSubscriptions({ forex: [...], indices: [...] })` une fois
 * au boot et `on('tick', cb)` pour s'abonner à tous les ticks.
 */
class ItickFeedRegistry extends EventEmitter {
  private managers = new Map<ItickAssetClass, ItickClusterManager>();

  private ensure(asset: ItickAssetClass): ItickClusterManager {
    let m = this.managers.get(asset);
    if (!m) {
      m = new ItickClusterManager(asset);
      m.on('tick', (tick: ItickLiveTick) => this.emit('tick', tick));
      this.managers.set(asset, m);
    }
    return m;
  }

  /** Configure tous les clusters en une fois. Les clusters non listés
   *  sont déconnectés. Les opens sont espacés de ~800ms pour éviter le
   *  rate-limit "burst" côté iTick (l'IP prend un 429 si on ouvre 2 WS
   *  simultanément en moins de quelques centaines de ms). */
  setSubscriptions(byAsset: Partial<Record<ItickAssetClass, string[]>>): void {
    const STAGGER_MS = 800;
    const wanted = new Set<ItickAssetClass>();
    const entries = Object.entries(byAsset) as [ItickAssetClass, string[]][];
    entries.forEach(([asset, codes], idx) => {
      if (!codes || codes.length === 0) return;
      wanted.add(asset);
      const m = this.ensure(asset);
      if (idx === 0) {
        m.setSymbols(codes);
      } else {
        setTimeout(() => m.setSymbols(codes), idx * STAGGER_MS).unref?.();
      }
    });
    for (const [asset, m] of this.managers.entries()) {
      if (!wanted.has(asset)) m.setSymbols([]);
    }
  }

  /**
   * Ajoute des symboles à un cluster sans toucher aux autres. Utilisé
   * par la page /feed-test pour s'abonner à un instrument sans casser
   * les subscriptions prod déjà en place.
   */
  setSubscription(asset: ItickAssetClass, codes: string[]): void {
    this.ensure(asset).addSymbols(codes);
  }

  ensureSubscribed(codes: string[], asset: ItickAssetClass = 'forex'): void {
    this.ensure(asset).addSymbols(codes);
  }

  getLatest(symbol: string, asset?: ItickAssetClass): ItickLiveTick | undefined {
    if (asset) return this.managers.get(asset)?.getLatest(symbol);
    for (const m of this.managers.values()) {
      const t = m.getLatest(symbol);
      if (t) return t;
    }
    return undefined;
  }

  resetCooldown(): void {
    for (const m of this.managers.values()) m.resetCooldown();
  }

  disconnect(): void {
    for (const m of this.managers.values()) m.disconnect();
  }

  getStatus() {
    const clusters = [...this.managers.values()].map((m) => m.getStatus());
    return {
      clusters,
      // Backward-compat avec l'ancienne page /feed-test : on remonte le
      // premier cluster comme "feed" principal.
      ...(clusters[0] ? {
        connected: clusters[0].connected,
        authenticated: clusters[0].authenticated,
        asset: clusters[0].asset,
        symbols: clusters[0].symbols,
        cooldownRemainingMs: clusters[0].cooldownRemainingMs,
        lastError: clusters[0].lastError,
        latest: clusters[0].latest,
      } : {}),
    };
  }
}

export const itickFeed = new ItickFeedRegistry();

export function getLiveTickStatus() {
  return itickFeed.getStatus();
}
