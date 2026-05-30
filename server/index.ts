import 'dotenv/config';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import http from 'http';
import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { PlayerManager } from './playerManager.js';
import { EventConfig, StatePatch } from './types.js';
import * as kraken from './kraken.js';
import * as binance from './binance.js';
import { pairToBinanceSymbol } from './binance.js';
import * as hyperliquid from './hyperliquid.js';
import * as engineCandlesCache from './engineCandlesCache.js';
import * as itick from './itick.js';
import * as itickCandles from './itickCandles.js';
import { ITICK_INSTRUMENTS, findByPair as findItickByPair, symbolsByAsset as itickSymbolsByAsset, isItickPair, registerItickCrypto, cryptoCodes as itickCryptoCodes } from './itickInstruments.js';
import { startItickToPaperBridge } from './itickToPaperBridge.js';
import { getPaperPairDefinition, CRYPTO_LIVE_PAIRS } from './exchangePaperEngine.js';
import { CompetitionManager } from './competitionManager.js';
import { sendOtpEmail } from './mailer.js';
import { checkSmsOtp, isSmsLive, sendSmsOtp } from './smsSender.js';
import { getMarketMetadata } from './marketMetadata.js';
import { optimizeUploadedImage } from './imageOptimize.js';
import { invalidateBlobCache } from './blobCache.js';
import { sendImageBlob } from './serveImageBlob.js';

const app = express();
const server = http.createServer(app);
// permessage-deflate compresses every WS frame natively. With state:patch
// payloads being mostly repetitive JSON keys, gzip typically yields a 3-5x
// reduction on the wire. We tune it to favor latency over CPU: small window,
// no compression for tiny frames, and an explicit memory budget so a burst
// of 500+ clients does not blow up RAM.
const wss = new WebSocketServer({
  noServer: true,
  perMessageDeflate: {
    zlibDeflateOptions: { chunkSize: 1024, memLevel: 7, level: 3 },
    zlibInflateOptions: { chunkSize: 10 * 1024 },
    clientNoContextTakeover: true,
    serverNoContextTakeover: true,
    serverMaxWindowBits: 10,
    concurrencyLimit: 10,
    threshold: 1024,
  },
});

// Canal WS isolé pour /feed-test : forward des ticks iTick live aux
// navigateurs sans toucher au pipeline /ws principal (compétition).
const itickWss = new WebSocketServer({ noServer: true });

// Dispatcher manuel : ws.js fait un startsWith(path) qui ferait intercepter
// /ws/itick par le serveur principal /ws. On route nous-mêmes selon le
// pathname exact pour éviter ce conflit.
server.on('upgrade', (req, socket, head) => {
  let pathname: string;
  try {
    pathname = new URL(req.url || '', 'http://localhost').pathname;
  } catch {
    socket.destroy();
    return;
  }
  if (pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else if (pathname === '/ws/itick') {
    itickWss.handleUpgrade(req, socket, head, (ws) => itickWss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});
const itickClients = new Set<WebSocket>();
itickWss.on('connection', (ws) => {
  itickClients.add(ws);
  // Greeting + replay du dernier tick connu pour chaque symbole abonné côté
  // serveur, pour que le navigateur reçoive immédiatement la valeur courante.
  try {
    const status = itick.getLiveTickStatus();
    ws.send(JSON.stringify({ type: 'itick:status', data: status }));
    for (const entry of status.latest) {
      ws.send(JSON.stringify({
        type: 'itick:tick',
        data: { symbol: entry.symbol, price: entry.price, ts: Date.now() - entry.ageMs },
      }));
    }
  } catch {
    // noop
  }
  ws.on('close', () => itickClients.delete(ws));
});
itick.itickFeed.on('tick', (tick) => {
  if (itickClients.size === 0) return;
  const msg = JSON.stringify({ type: 'itick:tick', data: tick });
  for (const client of itickClients) {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(msg); } catch { /* noop */ }
    }
  }
});
const PORT = Number(process.env.PORT || 3001);
const IS_SERVERLESS = Boolean(process.env.NETLIFY);

const UPLOADS_DIR = process.env.NETLIFY
  ? path.join('/tmp', 'btf-uploads')
  : path.join(process.cwd(), 'data', 'uploads');
try {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
} catch (err) {
  console.warn('[uploads] mkdir failed, falling back to memory only:', (err as Error).message);
}

const upload = multer({
  storage: process.env.NETLIFY
    ? multer.memoryStorage()
    : multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
      },
    }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp)$/i;
    cb(null, allowed.test(path.extname(file.originalname)));
  },
});

function uploadedImageUrl(file: Express.Multer.File): string {
  if (file.buffer?.length) {
    return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
  }
  return `/uploads/${file.filename}`;
}

// CORS : ouvert par défaut (front et back peuvent être sur des domaines
// distincts), restreint à une liste blanche si CORS_ORIGINS est défini
// (ex: "https://btf.app,https://www.btf.app").
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
if (CORS_ORIGINS.length > 0) {
  app.use(cors({
    origin: (origin, cb) => {
      // Requêtes same-origin / outils serveur (pas de header Origin) autorisées.
      if (!origin || CORS_ORIGINS.includes(origin)) return cb(null, true);
      cb(new Error('Origine non autorisée'));
    },
  }));
} else {
  app.use(cors());
}
app.use(express.json());

/**
 * Rate limiter en mémoire (fenêtre glissante) par IP + clé de route.
 * Suffisant sur un serveur Node persistant (Railway). Sur du serverless
 * multi-instance, c'est best-effort (chaque instance a son compteur), mais
 * ça reste une barrière utile contre le brute-force/spam.
 */
const rateBuckets = new Map<string, number[]>();
function rateLimit(opts: { windowMs: number; max: number; key: string }) {
  return (req: express.Request, res: express.Response, next: express.NextFunction): void => {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket.remoteAddress
      || 'unknown';
    const bucketKey = `${opts.key}:${ip}`;
    const now = Date.now();
    const hits = (rateBuckets.get(bucketKey) || []).filter((ts) => now - ts < opts.windowMs);
    if (hits.length >= opts.max) {
      res.status(429).json({ error: 'Trop de requêtes, réessaie dans quelques minutes.' });
      return;
    }
    hits.push(now);
    rateBuckets.set(bucketKey, hits);
    next();
  };
}
// Purge périodique des buckets vides pour éviter une fuite mémoire.
setInterval(() => {
  const now = Date.now();
  for (const [key, hits] of rateBuckets.entries()) {
    const fresh = hits.filter((ts) => now - ts < 15 * 60 * 1000);
    if (fresh.length === 0) rateBuckets.delete(key);
    else rateBuckets.set(key, fresh);
  }
}, 5 * 60 * 1000).unref?.();
app.use('/uploads', express.static(UPLOADS_DIR));
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    runtime: process.env.NETLIFY ? 'netlify-function' : 'node-server',
    uptime: process.uptime(),
  });
});
app.get('/uploads/:filename', (req, res) => {
  const label = String(req.params.filename || 'BTF')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 3)
    .toUpperCase() || 'BTF';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="28" fill="#111827"/><circle cx="48" cy="38" r="16" fill="#64748b"/><path d="M20 82c5-18 18-28 28-28s23 10 28 28" fill="#64748b"/><text x="48" y="90" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" font-weight="700" fill="#e5e7eb">${label}</text></svg>`;
  res.type('image/svg+xml').send(svg);
});

const clients = new Set<WebSocket>();
const competitionManager = new CompetitionManager();
let finalizingEndedCompetitions: Promise<void> | null = null;
const paperClients = new Map<WebSocket, { token: string; playerId: string; competitionId: string | null }>();
// Per-competition shard: every paperClient is also tracked under its
// competitionId so we can broadcast a leaderboard diff only to the
// traders of that arena, not to every connected client.
const arenaClients = new Map<string, Set<WebSocket>>();
// Last broadcast snapshot per arena for diff computation. Indexed by
// competitionId then by userId.
const arenaSnapshots = new Map<string, Map<string, {
  rank: number;
  pnlPercent: number;
  pnlUsd: number;
  tradesCount: number;
  updatedAt: number;
  avatarUrl: string | null;
}>>();

// --- Admin auth (single shared code, configurable via env) ---
// Aucun fallback en dur : si ADMIN_CODE n'est pas défini, l'accès admin est
// désactivé (fail-closed) plutôt que d'exposer un code par défaut connu.
const ADMIN_CODE = (process.env.ADMIN_CODE || '').trim();
if (!ADMIN_CODE) {
  console.warn('[admin] ADMIN_CODE non défini — login admin désactivé jusqu’à sa configuration.');
}

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
// Le compte de test (ARTEMTEST987) bypasse l'OTP : il ne doit JAMAIS être
// actif en production sauf activation explicite via ALLOW_TEST_LOGIN=true.
const ALLOW_TEST_LOGIN = process.env.ALLOW_TEST_LOGIN === 'true' || !IS_PRODUCTION;
// Les codes OTP de secours (devCode/devSmsCode) ne sont renvoyés au client
// qu'en dehors de la production.
const EXPOSE_DEV_OTP = !IS_PRODUCTION;

function getAdminToken(req: express.Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length);
  const direct = req.headers['x-admin-token'];
  if (typeof direct === 'string' && direct) return direct;
  return null;
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const token = getAdminToken(req);
  if (!token) {
    res.status(401).json({ error: 'Acces admin requis' });
    return;
  }
  competitionManager
    .hasAdminToken(token)
    .then((ok) => {
      if (!ok) {
        res.status(401).json({ error: 'Acces admin requis' });
        return;
      }
      next();
    })
    .catch(() => {
      res.status(500).json({ error: 'Erreur verification admin' });
    });
}
const manager = new PlayerManager((patch: StatePatch) => {
  // Broadcast a lightweight diff to every connected client. New trades,
  // PnL/balance/rank deltas and one-shot signals are all carried in the
  // patch payload so the wire size stays in the few-KB range even for a
  // 500+ trader competition.
  const msg = JSON.stringify({ type: 'state:patch', data: patch });
  clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
  // Sync online-competition (paper) traders whose PnL changed into their
  // competition.entries before pushing arena diffs. This keeps the
  // arena leaderboard live (rank changes when prices move) without
  // walking every player on every tick.
  const dirtyPaperPlayers = manager.drainDirtyPaperPlayers();
  for (const player of dirtyPaperPlayers) {
    competitionManager.updatePaperResultByPlayerId(player.id, {
      pnlUsd: player.pnl,
      pnlPercent: player.pnlPercent,
      tradesCount: player.tradeCount,
    });
  }
  broadcastPaperUpdates();
});

manager.setMarketTickBroadcaster((pairs) => broadcastMarketTicks(pairs));

function broadcastMarketTicks(pairs: string[]): void {
  if (pairs.length === 0 || clients.size === 0) return;
  const market = manager.getPaperMarketSnapshot();
  const ticks = pairs
    .map((pair) => market[pair])
    .filter((ticker): ticker is NonNullable<typeof ticker> => Boolean(ticker))
    .map((ticker) => ({
      pair: ticker.pair,
      markPrice: ticker.markPrice,
      bidPrice: ticker.bidPrice,
      askPrice: ticker.askPrice,
      updatedAt: ticker.updatedAt,
      marketOpen: ticker.marketOpen,
      marketClosedLabel: ticker.marketClosedLabel,
    }));
  if (ticks.length === 0) return;
  const msg = JSON.stringify({ type: 'market:tick', data: { ticks } });
  // Broadcast to every connected client: market prices are public data and
  // every chart consumer (logged-in or not) should see a live last-bar.
  clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

/**
 * Routes iTick (https://docs.itick.org/).
 * Lecture seule, pas d'auth (le token reste serveur-side via ITICK_TOKEN).
 * Source unique pour les pairs forex / commodities / indices ; le live
 * arrive via WS upstream et alimente le paper engine via le bridge.
 */
app.get('/api/itick/status', (_req, res) => {
  res.json({
    ok: true,
    configured: itick.isConfigured(),
    feed: itick.getLiveTickStatus(),
  });
});

/**
 * GET /api/itick/candles-status — récap par (pair, TF) du nombre de
 * bougies en DB, leur âge, et la plage temporelle couverte. Utile pour
 * vérifier la profondeur d'historique et la fraîcheur du backfill.
 */
app.get('/api/itick/candles-status', async (_req, res) => {
  try {
    const rows = await itickCandles.getCandlesStatus();
    res.json({ rows });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/admin/itick/backfill?force=true — relance manuellement le
 * backfill historique complet. Utile après un upgrade Neon ou pour
 * combler des données manquantes sans redéployer.
 */
app.post('/api/admin/itick/backfill', requireAdmin, async (req, res) => {
  const force = String(req.query.force || '') === 'true';
  // Lance en background — la requête répond immédiatement.
  void itickCandles
    .backfillAll(force)
    .catch((err) => console.warn('[admin] backfillAll KO:', (err as Error).message));
  res.json({ ok: true, started: true, force });
});

function parseAsset(raw: unknown): itick.ItickAssetClass {
  const v = String(raw || 'forex').toLowerCase();
  if (v === 'indices' || v === 'crypto' || v === 'stock' || v === 'forex') return v;
  return 'forex';
}

/**
 * GET /api/itick/candles — bougies historiques.
 *
 * Modes :
 *   1. `?pair=EUR/USD&interval=1&countBack=500` — lit le store iTick local
 *      (Postgres `itick_candles`), le plus rapide. Si aucune bougie n'est
 *      en cache, déclenche un backfill REST iTick (avec fallback Hyperliquid).
 *   2. `?code=EURUSD&asset=forex&interval=1` — appel direct iTick REST,
 *      utilisé par la page /feed-test pour debug pure source.
 */
app.get('/api/itick/candles', async (req, res) => {
  try {
    const interval = Number(req.query.interval || 1);
    const limit = Number(req.query.limit || req.query.countBack || 500);
    const to = req.query.to ? Number(req.query.to) : undefined;
    const endTs = to && to > 0 ? Math.floor(to) * 1000 : undefined;

    // Mode 1 : pair-based (production)
    const pairParam = req.query.pair ? String(req.query.pair) : null;
    if (pairParam) {
      const inst = findItickByPair(pairParam);
      if (!inst) {
        res.status(404).json({ error: `Pair iTick inconnue: ${pairParam}` });
        return;
      }
      let bars = await itickCandles.getCandles(inst.pair, interval, {
        countBack: limit,
        to: to ? Math.floor(to) : undefined,
      });
      if (bars.length === 0) {
        const nowSec = Math.floor(Date.now() / 1000);
        const targetTo = to ? Math.floor(to) : nowSec;
        const targetFrom = targetTo - interval * 60 * limit;
        await itickCandles.backfillRange(inst.pair, interval, targetFrom, targetTo);
        bars = await itickCandles.getCandles(inst.pair, interval, {
          countBack: limit,
          to: to ? Math.floor(to) : undefined,
        });
      }
      res.json({ candles: bars, pair: inst.pair, asset: inst.asset });
      return;
    }

    // Mode 2 : raw code (legacy /feed-test)
    const code = String(req.query.code || 'EURUSD').toUpperCase();
    const asset = parseAsset(req.query.asset);
    const bars = await itick.getKline(code, interval, limit, endTs, asset);
    res.json({ candles: bars });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || 'iTick candles indisponibles' });
  }
});

app.get('/api/itick/tick', async (req, res) => {
  try {
    const code = String(req.query.code || 'EURUSD').toUpperCase();
    const asset = parseAsset(req.query.asset);
    const tick = await itick.getLatestTick(code, asset);
    res.json(tick);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || 'iTick tick indisponible' });
  }
});

/**
 * GET /api/itick/instruments — liste des paires production iTick avec
 * leur asset class et le code iTick. Utilisé par la page /feed-test pour
 * peupler le sélecteur d'instruments.
 */
app.get('/api/itick/instruments', (_req, res) => {
  res.json({
    instruments: ITICK_INSTRUMENTS.map((inst) => ({
      pair: inst.pair,
      asset: inst.asset,
      code: inst.code,
      category: inst.category,
      pricescale: inst.pricescale,
      label: inst.label,
    })),
  });
});

/**
 * GET /api/itick/series — état du store de bougies (count + age par pair/tf).
 * Utilisé par /feed-test pour voir la santé globale du feed.
 */
app.get('/api/itick/series', async (_req, res) => {
  try {
    const series = await itickCandles.getCandlesStatus();
    res.json({ series });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || 'series indisponibles' });
  }
});

/**
 * Bascule la subscription WS upstream (1 connexion / 3 syms max sur le
 * plan free) vers une nouvelle paire (asset, symbols). Utilisé par la
 * page /feed-test pour changer d'instrument à la volée.
 */
app.post('/api/itick/reset', (_req, res) => {
  itick.itickFeed.resetCooldown();
  res.json({ ok: true });
});

app.post('/api/itick/subscribe', (req, res) => {
  try {
    const asset = parseAsset(req.body?.asset);
    const rawSymbols = Array.isArray(req.body?.symbols)
      ? req.body.symbols
      : (req.body?.symbol ? [req.body.symbol] : []);
    const symbols = rawSymbols
      .map((s: unknown) => String(s).toUpperCase().trim())
      .filter((s: string) => s.length > 0)
      .slice(0, 3);
    if (symbols.length === 0) {
      res.status(400).json({ error: 'symbols vide' });
      return;
    }
    itick.itickFeed.setSubscription(asset, symbols);
    res.json({ ok: true, asset, symbols });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || 'subscribe impossible' });
  }
});

async function syncCompetitionResultForPlayer(playerId: string): Promise<void> {
  const player = manager.getPlayerById(playerId);
  if (!player) return;
  competitionManager.updatePaperResultByPlayerId(player.id, {
    pnlUsd: player.pnl,
    pnlPercent: player.pnlPercent,
    tradesCount: player.tradeCount,
  });
  if (IS_SERVERLESS) {
    await competitionManager.persist();
  } else {
    void competitionManager.persist();
  }
}

async function finalizeEndedCompetitions(): Promise<void> {
  if (finalizingEndedCompetitions) {
    await finalizingEndedCompetitions;
    return;
  }

  finalizingEndedCompetitions = (async () => {
    const pending = competitionManager.getCompetitionsNeedingFinalization();
    for (const competition of pending) {
      for (const playerId of competition.paperPlayerIds) {
        await manager.finalizeCompetitionPaperPlayer(playerId);
        await syncCompetitionResultForPlayer(playerId);
      }
      competitionManager.markCompetitionFinalized(competition.competitionId);
      await competitionManager.persist();
    }
  })();

  try {
    await finalizingEndedCompetitions;
  } finally {
    finalizingEndedCompetitions = null;
  }
}

async function syncAllCompetitionResults(): Promise<void> {
  await finalizeEndedCompetitions();
  for (const playerId of competitionManager.getPaperPlayerIds()) {
    await syncCompetitionResultForPlayer(playerId);
  }
}

async function getCompetitionIdForTraderToken(token: string | null): Promise<string | null> {
  if (!token) return null;
  const info = await competitionManager.getTraderSession(token);
  return info?.competitionId || null;
}

async function assertCompetitionTraderCanTrade(token: string | null): Promise<string | null> {
  const competitionId = await getCompetitionIdForTraderToken(token);
  if (!competitionId) return null;
  if (IS_SERVERLESS) await competitionManager.refresh();
  await finalizeEndedCompetitions();
  competitionManager.assertCompetitionTradingOpen(competitionId);
  return competitionId;
}

function getSessionToken(req: express.Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length);
}

function resyncCompetitionPlayerIsolation(): void {
  manager.reconcileOnlineCompetitionPlayers(competitionManager.getPaperPlayerIds());
}

async function refreshManagerState(): Promise<void> {
  await manager.refresh();
  resyncCompetitionPlayerIsolation();
}

async function getSessionPlayer(req: express.Request) {
  const token = getSessionToken(req);
  if (!token) return null;
  const info = await competitionManager.getTraderSession(token);
  if (!info) return null;
  let player = manager.getPlayerById(info.playerId);
  // On serverless every Lambda has its own in-memory state, so we always
  // refresh from Postgres. On a persistent Node server the in-memory state
  // is the source of truth — refreshing would clear positions/orders that
  // were just created by a concurrent mutation. We only refresh as a
  // last-resort fallback when the player is unknown to memory.
  if (IS_SERVERLESS) {
    await competitionManager.refresh();
    await refreshManagerState();
    player = manager.getPlayerById(info.playerId);
  } else if (!player) {
    await refreshManagerState();
    player = manager.getPlayerById(info.playerId);
  }
  return player;
}

async function getCompetitionUser(req: express.Request) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length);
  return competitionManager.getUserFromToken(token);
}

function publicPlayer(player: ReturnType<typeof manager.getPlayerById>) {
  if (!player) return null;
  const { apiKey: _k, apiSecret: _s, ...payload } = player;
  return payload;
}

function buildPaperUpdatePayload(playerId: string, competitionId: string | null) {
  const player = manager.getPlayerById(playerId);
  if (!player) return null;

  let competitionPayload: unknown = null;
  let canTrade = manager.canTradeLiveEvent();
  if (competitionId) {
    const status = competitionManager.getCompetitionStatus(competitionId);
    canTrade = status === 'live';
    competitionPayload = competitionManager.getCompetitionContextForPaperPlayer(competitionId, player.id) || { id: competitionId };
  }

  return {
    player: publicPlayer(player),
    market: manager.getChartMarketSnapshot(),
    canTrade,
    competition: competitionPayload,
  };
}

function sendPaperUpdate(ws: WebSocket, sub: { playerId: string; competitionId: string | null }): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    const payload = buildPaperUpdatePayload(sub.playerId, sub.competitionId);
    if (payload) ws.send(JSON.stringify({ type: 'paper:update', data: payload }));
  } catch {
    // A stale competition/player should not break the global websocket loop.
  }
}

function broadcastPaperUpdates(): void {
  paperClients.forEach((sub, ws) => sendPaperUpdate(ws, sub));
  broadcastArenaPatches();
}

type ArenaLeaderboardEntry = {
  rank: number;
  userId: string;
  name: string;
  avatarUrl: string | null;
  pnlPercent: number;
  pnlUsd: number;
  tradesCount: number;
  updatedAt: number;
};

type ArenaPatchEntry = {
  userId: string;
  name?: string;
  avatarUrl?: string | null;
  rank?: number;
  pnlPercent?: number;
  pnlUsd?: number;
  tradesCount?: number;
  updatedAt?: number;
};

function buildArenaInit(competitionId: string) {
  const data = competitionManager.getLiveLeaderboard(competitionId);
  if (!data) return null;
  return {
    competitionId,
    competition: data.competition,
    leaderboard: data.leaderboard as ArenaLeaderboardEntry[],
  };
}

function computeArenaPatch(
  competitionId: string,
  data: ReturnType<typeof competitionManager.getLiveLeaderboard>,
): {
  competitionId: string;
  competition: NonNullable<ReturnType<typeof competitionManager.getLiveLeaderboard>>['competition'];
  upserts: ArenaPatchEntry[];
  removed: string[];
} | null {
  if (!data) return null;
  const previous = arenaSnapshots.get(competitionId) || new Map();
  const next = new Map<string, ArenaLeaderboardEntry>();
  const upserts: ArenaPatchEntry[] = [];
  for (const entry of data.leaderboard) {
    next.set(entry.userId, entry);
    const prev = previous.get(entry.userId);
    if (
      !prev ||
      prev.rank !== entry.rank ||
      prev.pnlPercent !== entry.pnlPercent ||
      prev.pnlUsd !== entry.pnlUsd ||
      prev.tradesCount !== entry.tradesCount ||
      prev.updatedAt !== entry.updatedAt ||
      (prev.avatarUrl ?? null) !== (entry.avatarUrl ?? null)
    ) {
      const diff: ArenaPatchEntry = { userId: entry.userId };
      if (!prev) diff.name = entry.name;
      if (!prev || (prev.avatarUrl ?? null) !== (entry.avatarUrl ?? null)) diff.avatarUrl = entry.avatarUrl ?? null;
      if (!prev || prev.rank !== entry.rank) diff.rank = entry.rank;
      if (!prev || prev.pnlPercent !== entry.pnlPercent) diff.pnlPercent = entry.pnlPercent;
      if (!prev || prev.pnlUsd !== entry.pnlUsd) diff.pnlUsd = entry.pnlUsd;
      if (!prev || prev.tradesCount !== entry.tradesCount) diff.tradesCount = entry.tradesCount;
      if (!prev || prev.updatedAt !== entry.updatedAt) diff.updatedAt = entry.updatedAt;
      upserts.push(diff);
    }
  }
  const removed: string[] = [];
  for (const userId of previous.keys()) {
    if (!next.has(userId)) removed.push(userId);
  }
  // Persist the new snapshot for the next diff computation.
  arenaSnapshots.set(
    competitionId,
    new Map(
      Array.from(next.entries()).map(([k, v]) => [k, {
        rank: v.rank,
        pnlPercent: v.pnlPercent,
        pnlUsd: v.pnlUsd,
        tradesCount: v.tradesCount,
        updatedAt: v.updatedAt,
        avatarUrl: v.avatarUrl ?? null,
      }]),
    ),
  );
  if (upserts.length === 0 && removed.length === 0) return null;
  return {
    competitionId,
    competition: data.competition,
    upserts,
    removed,
  };
}

function broadcastArenaPatches(): void {
  if (arenaClients.size === 0) return;
  for (const [competitionId, sockets] of arenaClients) {
    if (sockets.size === 0) continue;
    const data = competitionManager.getLiveLeaderboard(competitionId);
    if (!data) continue;
    const patch = computeArenaPatch(competitionId, data);
    if (!patch) continue;
    const msg = JSON.stringify({ type: 'arena:patch', data: patch });
    sockets.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    });
  }
}

function attachArenaClient(ws: WebSocket, competitionId: string): void {
  let bucket = arenaClients.get(competitionId);
  if (!bucket) {
    bucket = new Set();
    arenaClients.set(competitionId, bucket);
  }
  bucket.add(ws);
  // Send full snapshot so the client can render the leaderboard immediately.
  const init = buildArenaInit(competitionId);
  if (init && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'arena:init', data: init }));
    // Prime the diff baseline with the snapshot we just sent.
    const baseline = new Map<string, {
      rank: number; pnlPercent: number; pnlUsd: number; tradesCount: number; updatedAt: number; avatarUrl: string | null;
    }>();
    for (const entry of init.leaderboard) {
      baseline.set(entry.userId, {
        rank: entry.rank,
        pnlPercent: entry.pnlPercent,
        pnlUsd: entry.pnlUsd,
        tradesCount: entry.tradesCount,
        updatedAt: entry.updatedAt,
        avatarUrl: entry.avatarUrl ?? null,
      });
    }
    // Only refresh the snapshot if we have nothing yet. Other concurrent
    // shards may already keep their own up-to-date baseline.
    if (!arenaSnapshots.has(competitionId)) {
      arenaSnapshots.set(competitionId, baseline);
    }
  }
}

function detachArenaClient(ws: WebSocket): void {
  for (const [competitionId, sockets] of arenaClients) {
    if (sockets.delete(ws) && sockets.size === 0) {
      arenaClients.delete(competitionId);
      arenaSnapshots.delete(competitionId);
    }
  }
}

wss.on('connection', (ws, req) => {
  clients.add(ws);

  // Send a full snapshot to the freshly connected client. Subsequent
  // updates arrive as small diffs (`state:patch`), which keeps a 500-trader
  // competition under a few KB per broadcast.
  const initialState = manager.getStateInit();
  ws.send(JSON.stringify({ type: 'state:init', data: initialState }));

  const url = new URL(req.url || '/ws', `http://${req.headers.host || 'localhost'}`);
  const paperToken = url.searchParams.get('paperToken');
  if (paperToken) {
    void competitionManager.getTraderSession(paperToken).then((info) => {
      if (!info || ws.readyState !== WebSocket.OPEN) return;
      const sub = { token: paperToken, playerId: info.playerId, competitionId: info.competitionId };
      paperClients.set(ws, sub);
      sendPaperUpdate(ws, sub);
      if (info.competitionId) attachArenaClient(ws, info.competitionId);
    }).catch(() => undefined);
  }

  ws.on('close', () => {
    clients.delete(ws);
    paperClients.delete(ws);
    detachArenaClient(ws);
  });
});

// --- Admin auth ---

app.post('/api/admin/login', rateLimit({ windowMs: 10 * 60 * 1000, max: 10, key: 'admin-login' }), async (req, res) => {
  const code = String(req.body?.code || '').trim();
  if (!ADMIN_CODE) {
    res.status(503).json({ error: 'Admin non configuré' });
    return;
  }
  if (!code || code !== ADMIN_CODE) {
    res.status(401).json({ error: 'Code admin incorrect' });
    return;
  }
  const token = crypto.randomBytes(32).toString('hex');
  await competitionManager.addAdminToken(token);
  res.json({ token });
});

app.get('/api/admin/check', async (req, res) => {
  const token = getAdminToken(req);
  const ok = token ? await competitionManager.hasAdminToken(token) : false;
  res.json({ ok });
});

app.post('/api/admin/logout', async (req, res) => {
  const token = getAdminToken(req);
  if (token) await competitionManager.deleteAdminToken(token);
  res.json({ ok: true });
});

// --- Roster: register players (persistent) ---

app.post('/api/roster', requireAdmin, async (req, res) => {
  const { name, apiKey, apiSecret, skipValidation } = req.body;
  const config = manager.getEventConfig();

  if (!name) {
    res.status(400).json({ error: 'name required' });
    return;
  }

  let verified = false;
  if (config.platformMode === 'kraken' && (!apiKey || !apiSecret)) {
    res.status(400).json({ error: 'name, apiKey, apiSecret required' });
    return;
  }

  if (config.platformMode === 'kraken' && !skipValidation) {
    try {
      verified = await kraken.testConnection(apiKey, apiSecret);
      if (!verified) {
        res.status(400).json({ error: 'Clés API Kraken Futures invalides — vérifiez que les permissions Futures sont activées sur votre clé' });
        return;
      }
    } catch (err: any) {
      console.error('API validation error:', err);
      res.status(400).json({ error: `Erreur de validation: ${err.message || 'connexion impossible'}` });
      return;
    }
  }

  const player = manager.registerPlayer(
    name,
    config.platformMode === 'kraken' ? apiKey : '',
    config.platformMode === 'kraken' ? apiSecret : '',
  );
  player.connected = config.platformMode === 'paper' ? true : verified;
  const { apiKey: _k, apiSecret: _s, ...publicPlayer } = player;
  res.json(publicPlayer);
});

app.get('/api/roster', (_req, res) => {
  res.json(manager.getRosterPublic());
});

app.delete('/api/roster/:id', requireAdmin, (req, res) => {
  manager.removePlayer(req.params.id);
  res.json({ ok: true });
});

// --- Toggle: activate/deactivate player for competition ---

app.patch('/api/roster/:id/toggle', requireAdmin, (req, res) => {
  const player = manager.togglePlayer(req.params.id);
  if (!player) {
    res.status(404).json({ error: 'Joueur introuvable' });
    return;
  }
  const { apiKey: _k, apiSecret: _s, ...publicPlayer } = player;
  res.json(publicPlayer);
});

// --- Avatar upload ---

app.post('/api/roster/:id/avatar', requireAdmin, upload.single('avatar'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Fichier image requis' });
    return;
  }
  try {
    let buffer = req.file.buffer;
    if (!buffer && req.file.path) {
      buffer = await fs.promises.readFile(req.file.path);
      fs.promises.unlink(req.file.path).catch(() => undefined);
    }
    if (!buffer || buffer.length === 0) {
      res.status(400).json({ error: 'Fichier image illisible' });
      return;
    }
    const mime = req.file.mimetype || 'image/jpeg';
    const optimized = await optimizeUploadedImage(buffer, { maxSide: 512, quality: 80 });
    let avatarUrl: string;
    try {
      avatarUrl = await manager.putRosterAvatar(req.params.id, optimized.mime, optimized.buffer);
    } catch (err: any) {
      // Fallback dev local sans Postgres : data URL inline.
      if (err?.message?.includes('Database')) {
        avatarUrl = `data:${mime};base64,${buffer.toString('base64')}`;
        const fallback = manager.setAvatar(req.params.id, avatarUrl);
        if (!fallback) {
          res.status(404).json({ error: 'Joueur introuvable' });
          return;
        }
      } else {
        throw err;
      }
    }
    const player = manager.getPublicPlayers().find((p) => p.id === req.params.id);
    if (!player) {
      res.status(404).json({ error: 'Joueur introuvable' });
      return;
    }
    res.json(player);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Upload avatar impossible' });
  }
});

/**
 * Sert l'avatar d'un joueur du roster live depuis le blob Postgres.
 * Same pattern que /api/avatars/:userId (compétition online) — l'URL
 * inclut un `?v=<timestamp>` pour casser le cache au prochain upload.
 */
app.get('/api/roster/avatars/:playerId', async (req, res) => {
  const playerId = String(req.params.playerId);
  try {
    await sendImageBlob(
      res,
      `roster:${playerId}`,
      () => manager.getRosterAvatar(playerId),
      String(req.query.w || ''),
    );
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Lecture impossible' });
  }
});

// --- Active players (for dashboard) ---

app.get('/api/players', (_req, res) => {
  res.json(manager.getPublicPlayers());
});

// --- Event config (mode & teams) ---

app.post('/api/event/config', requireAdmin, (req, res) => {
  const { mode, teams, platformMode, paperStartingBalance, eventDurationMinutes } = req.body as EventConfig;
  const marketDataSource = req.body?.marketDataSource === 'hyperliquid'
    ? 'binance'
    : req.body?.marketDataSource;
  if (!mode || !['1v1', '1v1v1', '1v1v1v1', '4v4'].includes(mode)) {
    res.status(400).json({ error: 'Mode invalide' });
    return;
  }
  if (!platformMode || !['kraken', 'paper'].includes(platformMode)) {
    res.status(400).json({ error: 'Plateforme invalide' });
    return;
  }
  if (!marketDataSource || !['kraken', 'binance'].includes(marketDataSource)) {
    res.status(400).json({ error: 'Source de data invalide' });
    return;
  }
  const startingBalance = Number(paperStartingBalance);
  if (!Number.isFinite(startingBalance) || startingBalance <= 0) {
    res.status(400).json({ error: 'Balance paper invalide' });
    return;
  }
  const durationMinutes = Number(eventDurationMinutes);
  if (eventDurationMinutes != null && (!Number.isFinite(durationMinutes) || durationMinutes < 0)) {
    res.status(400).json({ error: 'Durée de compétition invalide' });
    return;
  }

  manager.setEventConfig({
    mode,
    teams,
    platformMode,
    paperStartingBalance: startingBalance,
    marketDataSource,
    eventDurationMinutes: Number.isFinite(durationMinutes) ? Math.floor(durationMinutes) : undefined,
  });
  res.json({
    ok: true,
    mode,
    teams,
    platformMode,
    paperStartingBalance: startingBalance,
    marketDataSource,
    eventDurationMinutes: manager.getEventDurationMinutes(),
  });
});

app.get('/api/event/config', (_req, res) => {
  res.json(manager.getEventConfig());
});

// --- Event controls ---

app.post('/api/event/start', requireAdmin, async (_req, res) => {
  manager.prepareStart();
  const active = manager.getActivePlayers();
  if (active.length === 0) {
    res.status(400).json({ error: 'Aucun joueur actif dans la compétition' });
    return;
  }
  try {
    await manager.startEvent();
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Impossible de lancer l’événement' });
    return;
  }
  res.json({ ok: true, startTime: manager.getEventStartTime(), endTime: manager.getEventEndTime() });
});

app.post('/api/event/stop', requireAdmin, async (_req, res) => {
  manager.stopEvent();
  res.json({ ok: true });
});

app.get('/api/event/status', (_req, res) => {
  res.json({
    started: manager.isStarted(),
    startTime: manager.getEventStartTime(),
    endTime: manager.getEventEndTime(),
    durationMinutes: manager.getEventDurationMinutes(),
    playerCount: manager.getActivePlayers().length,
    rosterCount: manager.getPlayers().length,
    platformMode: manager.getPlatformMode(),
    paperStartingBalance: manager.getPaperStartingBalance(),
    marketDataSource: manager.getMarketDataSource(),
  });
});

// --- Event archives & showcase ---

app.get('/api/event/archives', requireAdmin, (_req, res) => {
  res.json({ archives: manager.listEventArchives(), showcase: manager.getEventShowcase() });
});

app.delete('/api/event/archives/:id', requireAdmin, async (req, res) => {
  const removed = await manager.deleteEventArchive(req.params.id);
  if (!removed) {
    res.status(404).json({ error: 'Archive introuvable' });
    return;
  }
  res.json({ ok: true });
});

app.get('/api/event/showcase', (_req, res) => {
  res.json({ showcase: manager.getEventShowcasePayload() });
});

app.post('/api/event/showcase', requireAdmin, async (req, res) => {
  const archiveId = typeof req.body?.archiveId === 'string' ? req.body.archiveId : null;
  const mode = req.body?.mode === 'podium' || req.body?.mode === 'stats' ? req.body.mode : null;
  if (archiveId && mode) {
    const ok = await manager.setEventShowcase({ archiveId, mode });
    if (!ok) {
      res.status(404).json({ error: 'Archive introuvable' });
      return;
    }
  } else {
    await manager.setEventShowcase(null);
  }
  res.json({ ok: true, showcase: manager.getEventShowcase() });
});

// --- Paper trading meta & auth ---

app.get('/api/paper/meta', async (_req, res) => {
  const pairs = manager.getSupportedPaperPairs();
  res.json({
    enabled: manager.getPlatformMode() === 'paper',
    eventStarted: manager.isStarted(),
    eventEndTime: manager.getEventEndTime(),
    eventDurationMinutes: manager.getEventDurationMinutes(),
    startingBalance: manager.getPaperStartingBalance(),
    pairs,
    market: await manager.refreshPaperMarketSnapshot(),
    marketMetadata: await getMarketMetadata(pairs),
    fees: manager.getPaperFeeRates(),
    marketDataSource: manager.getMarketDataSource(),
  });
});

app.get('/api/paper/candles', async (req, res) => {
  const pair = String(req.query.pair || 'BTC/USD');
  const interval = Number(req.query.interval || 1);
  const from = Number(req.query.from);
  const to = Number(req.query.to);
  const countBack = Number(req.query.countBack);
  const candleOpts = {
    from: Number.isFinite(from) && from > 0 ? from : undefined,
    to: Number.isFinite(to) && to > 0 ? to : undefined,
    countBack: Number.isFinite(countBack) && countBack > 0 ? countBack : undefined,
  };

  try {
    const pairDef = getPaperPairDefinition(pair);
    let candles;
    let source: 'itick' | 'hyperliquid' | 'binance' | 'kraken' = 'kraken';

    // Pair iTick (forex / commodity / index) → store local Postgres.
    // Si vide, backfill REST iTick (avec fallback Hyperliquid xyz si dispo).
    if (isItickPair(pair)) {
      let itickBars = await itickCandles.getCandles(pair, interval, candleOpts);
      if (itickBars.length === 0) {
        const nowSec = Math.floor(Date.now() / 1000);
        const targetTo = candleOpts.to ?? nowSec;
        const targetFrom = candleOpts.from ?? targetTo - interval * 60 * (candleOpts.countBack ?? 500);
        try {
          await itickCandles.backfillRange(pair, interval, targetFrom, targetTo);
        } catch (err) {
          // Quota / rate-limit iTick : on n'échoue pas la route, on
          // tombera juste sur le fallback Hyperliquid plus bas.
          console.warn(`[candles] backfill iTick ${pair} ${interval}m KO:`, (err as Error).message);
        }
        itickBars = await itickCandles.getCandles(pair, interval, candleOpts);
      }
      if (itickBars.length > 0) {
        candles = itickBars;
        source = 'itick';
      } else {
        // Dernier recours : Hyperliquid direct si on a un coin xyz pour
        // cette pair. Évite une 400 si iTick est complètement injoignable.
        try {
          candles = await hyperliquid.getOhlcCandles(pair, interval, candleOpts);
          source = 'hyperliquid';
        } catch {
          candles = [];
        }
      }
    } else if (pairDef?.source === 'kraken_futures' || pairToBinanceSymbol(pair)) {
      // Crypto : cache mémoire dont l'upstream suit la chaîne de fallback
      // Binance → iTick → Bybit (cf. cryptoCandles). Premier hit ~7s pour
      // 40k bars, suivants instantanés.
      candles = await engineCandlesCache.getCachedCandles(pair, interval, 'binance', candleOpts);
      source = 'binance';
    } else if (manager.getMarketDataSource() === 'binance') {
      candles = await engineCandlesCache.getCachedCandles(pair, interval, 'binance', candleOpts);
      source = 'binance';
    } else {
      try {
        candles = await engineCandlesCache.getCachedCandles(pair, interval, 'kraken', candleOpts);
      } catch (err) {
        console.warn(`[candles] cache miss ${pair}, direct Kraken:`, (err as Error).message);
        candles = await kraken.getOhlcCandles(pair, interval);
      }
      source = 'kraken';
    }
    res.json({ pair, interval, candles, source });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Historique indisponible' });
  }
});

app.post('/api/paper/session', rateLimit({ windowMs: 10 * 60 * 1000, max: 15, key: 'paper-session' }), async (req, res) => {
  if (manager.getPlatformMode() !== 'paper') {
    res.status(400).json({ error: 'Le mode paper n’est pas actif' });
    return;
  }

  const code = String(req.body?.accessCode || '').trim().toUpperCase();
  if (!code) {
    res.status(400).json({ error: 'Code trader requis' });
    return;
  }

  const player = manager.findPlayerByTraderCode(code);
  if (!player || !player.active) {
    res.status(404).json({ error: 'Trader introuvable ou non activé' });
    return;
  }

  if (IS_SERVERLESS) await competitionManager.refresh();
  const competitionPaperIds = new Set(competitionManager.getPaperPlayerIds());
  if (
    competitionPaperIds.has(player.id)
    || manager.isOnlineCompetitionPlayer(player.id)
  ) {
    res.status(403).json({
      error: 'Ce compte est réservé à BTF Arena Compete. Connecte-toi via /compete.',
    });
    return;
  }

  const token = crypto.randomBytes(24).toString('hex');
  await competitionManager.setTraderSession(token, player.id, null);
  const { apiKey: _k, apiSecret: _s, ...publicPlayer } = player;

  // Renvoie un payload complet (player + market + canTrade + pairs) pour
  // que le front puisse bootstrapper le terminal Live sans round-trip
  // /api/paper/me supplémentaire au mount.
  res.json({
    token,
    player: publicPlayer,
    market: manager.getChartMarketSnapshot(),
    fees: manager.getPaperFeeRates(),
    pairs: manager.getSupportedPaperPairs(),
    startingBalance: manager.getPaperStartingBalance(),
    marketDataSource: manager.getMarketDataSource(),
    eventStarted: manager.isStarted(),
    eventEndTime: manager.getEventEndTime(),
    canTrade: manager.canTradeLiveEvent(),
    competition: null,
  });
});

app.get('/api/paper/me', async (req, res) => {
  const token = getSessionToken(req);
  let player = await getSessionPlayer(req);
  if (!player) {
    res.status(401).json({ error: 'Session invalide' });
    return;
  }

  const competitionId = token ? ((await competitionManager.getTraderSession(token))?.competitionId || null) : null;
  const isCompetition = Boolean(competitionId);

  let competitionPayload: unknown = null;
  if (competitionId) {
    if (IS_SERVERLESS) await competitionManager.refresh();
    await finalizeEndedCompetitions();
    const refreshedPlayer = await manager.refreshCompetitionPaperPlayer(player.id, {
      forceMarketRefresh: IS_SERVERLESS,
      persist: IS_SERVERLESS,
    });
    if (refreshedPlayer) player = refreshedPlayer;
    await syncCompetitionResultForPlayer(player.id);
    const ctx = competitionManager.getCompetitionContextForPaperPlayer(competitionId, player.id);
    competitionPayload = ctx || { id: competitionId };
  }
  const competitionStatus = competitionId ? competitionManager.getCompetitionStatus(competitionId) : null;
  const { apiKey: _k, apiSecret: _s, ...publicPlayer } = player;

  res.json({
    player: publicPlayer,
    market: manager.getChartMarketSnapshot(),
    fees: manager.getPaperFeeRates(),
    pairs: manager.getSupportedPaperPairs(),
    startingBalance: isCompetition ? manager.getCompetitionStartingBalance() : manager.getPaperStartingBalance(),
    marketDataSource: manager.getMarketDataSource(),
    eventStarted: manager.isStarted(),
    eventEndTime: manager.getEventEndTime(),
    canTrade: isCompetition ? competitionStatus === 'live' : manager.canTradeLiveEvent(),
    competition: competitionPayload,
  });
});

app.post('/api/paper/order', async (req, res) => {
  const token = getSessionToken(req);
  const player = await getSessionPlayer(req);
  if (!player) {
    res.status(401).json({ error: 'Session invalide' });
    return;
  }

  const { pair, side, size, orderType, limitPrice, leverage, stopLoss, takeProfit } = req.body || {};
  if (side !== 'long' && side !== 'short') {
    res.status(400).json({ error: 'Sens d’ordre invalide (long ou short)' });
    return;
  }
  try {
    const competitionId = await assertCompetitionTraderCanTrade(token);
    const handler = competitionId
      ? manager.placeCompetitionPaperOrder.bind(manager)
      : manager.placePaperOrder.bind(manager);
    await handler(player.id, {
      pair,
      side,
      size: Number(size),
      orderType,
      limitPrice: limitPrice == null ? null : Number(limitPrice),
      leverage: Number(leverage),
      stopLoss: stopLoss == null || stopLoss === '' ? null : Number(stopLoss),
      takeProfit: takeProfit == null || takeProfit === '' ? null : Number(takeProfit),
    });
    if (competitionId) await syncCompetitionResultForPlayer(player.id);
    res.json({ ok: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Ordre refusé' });
  }
});

app.post('/api/paper/order/limit', async (req, res) => {
  const token = getSessionToken(req);
  const player = await getSessionPlayer(req);
  if (!player) {
    res.status(401).json({ error: 'Session invalide' });
    return;
  }

  const { orderId, limitPrice } = req.body || {};
  try {
    const competitionId = await assertCompetitionTraderCanTrade(token);
    const oid = String(orderId || '');
    const price = Number(limitPrice);
    if (competitionId) {
      await manager.updateCompetitionPaperOrderLimitPrice(player.id, oid, price);
      await syncCompetitionResultForPlayer(player.id);
    } else {
      manager.updatePaperOrderLimitPrice(player.id, oid, price);
    }
    res.json({ ok: true });
  } catch (error: any) {
    const msg = error?.message || 'Modification du prix limite refusée';
    if (typeof msg === 'string' && msg.includes('Ordre introuvable')) {
      res.json({ ok: true, alreadyClosed: true });
      return;
    }
    res.status(400).json({ error: msg });
  }
});

app.post('/api/paper/cancel', async (req, res) => {
  const token = getSessionToken(req);
  const player = await getSessionPlayer(req);
  if (!player) {
    res.status(401).json({ error: 'Session invalide' });
    return;
  }

  try {
    const competitionId = await assertCompetitionTraderCanTrade(token);
    const orderId = String(req.body?.orderId || '');
    if (competitionId) {
      const result = await manager.cancelCompetitionPaperOrder(player.id, orderId);
      await syncCompetitionResultForPlayer(player.id);
      res.json({ ok: true, alreadyClosed: result.alreadyClosed });
    } else {
      manager.cancelPaperOrder(player.id, orderId);
      res.json({ ok: true });
    }
  } catch (error: any) {
    const msg = error?.message || 'Annulation refusée';
    if (typeof msg === 'string' && msg.includes('Ordre introuvable')) {
      res.json({ ok: true, alreadyClosed: true });
      return;
    }
    console.error('[paper/cancel] failed:', msg);
    res.status(400).json({ error: msg });
  }
});

app.post('/api/paper/close', async (req, res) => {
  const token = getSessionToken(req);
  const player = await getSessionPlayer(req);
  if (!player) {
    res.status(401).json({ error: 'Session invalide' });
    return;
  }

  try {
    const competitionId = await assertCompetitionTraderCanTrade(token);
    const rawSize = req.body?.size;
    const rawPercent = req.body?.percent;
    const positionRef = String(req.body?.positionId || req.body?.pair || '');
    let partialSize: number | undefined;
    if (rawSize != null && rawSize !== '') {
      const numeric = Number(rawSize);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        res.status(400).json({ error: 'Taille de fermeture invalide' });
        return;
      }
      partialSize = numeric;
    }
    if (partialSize == null && rawPercent != null && rawPercent !== '') {
      const pct = Number(rawPercent);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
        res.status(400).json({ error: 'Pourcentage de fermeture invalide' });
        return;
      }
      const playerForSize = manager.getPlayerById(player.id);
      const position = playerForSize?.openPositions.find((entry) => entry.id === positionRef)
        ?? playerForSize?.openPositions.find((entry) => entry.pair === positionRef);
      if (position) partialSize = position.size * (pct / 100);
    }
    if (competitionId) {
      const result = await manager.closeCompetitionPaperPosition(player.id, positionRef, partialSize);
      await syncCompetitionResultForPlayer(player.id);
      res.json({ ok: true, alreadyClosed: result.alreadyClosed });
    } else {
      await manager.closePaperPosition(player.id, positionRef, partialSize);
      res.json({ ok: true });
    }
  } catch (error: any) {
    const msg = error?.message || 'Clôture refusée';
    // Idempotent fallback: if the engine still rejected the close because
    // the position vanished mid-flight (race with SL/TP trigger), tell the
    // client it's already closed instead of surfacing a confusing error.
    if (typeof msg === 'string' && msg.includes('Position introuvable')) {
      res.json({ ok: true, alreadyClosed: true });
      return;
    }
    console.error('[paper/close] failed:', msg);
    res.status(400).json({ error: msg });
  }
});

app.post('/api/paper/risk', async (req, res) => {
  const token = getSessionToken(req);
  const player = await getSessionPlayer(req);
  if (!player) {
    res.status(401).json({ error: 'Session invalide' });
    return;
  }

  const { pair, positionId, orderId, stopLoss, takeProfit, stopLossSize, takeProfitSize } = req.body || {};
  try {
    const competitionId = await assertCompetitionTraderCanTrade(token);
    const isCompetition = Boolean(competitionId);
    const options = {
      stopLossSize: stopLossSize == null || stopLossSize === '' ? null : Number(stopLossSize),
      takeProfitSize: takeProfitSize == null || takeProfitSize === '' ? null : Number(takeProfitSize),
    };
    const sl = stopLoss == null ? null : Number(stopLoss);
    const tp = takeProfit == null ? null : Number(takeProfit);
    if (orderId) {
      const oid = String(orderId);
      if (isCompetition) {
        await manager.updateCompetitionPaperOrderRisk(player.id, oid, sl, tp);
        await syncCompetitionResultForPlayer(player.id);
      } else {
        manager.updatePaperOrderRisk(player.id, oid, sl, tp);
      }
      res.json({ ok: true });
      return;
    }
    const positionRef = String(positionId || pair || '');
    if (isCompetition) {
      await manager.updateCompetitionPaperPositionRisk(player.id, positionRef, sl, tp, options);
      await syncCompetitionResultForPlayer(player.id);
    } else {
      manager.updatePaperPositionRisk(player.id, positionRef, sl, tp, options);
    }
    res.json({ ok: true });
  } catch (error: any) {
    const msg = error?.message || 'Modification SL/TP refusée';
    if (typeof msg === 'string' && msg.includes('Position introuvable')) {
      res.json({ ok: true, alreadyClosed: true });
      return;
    }
    console.error('[paper/risk] failed:', msg);
    res.status(400).json({ error: msg });
  }
});

// --- Competition platform: auth, join, public leaderboard ---

/**
 * Login direct via pseudo magique (compte de test). Pas de mail/SMS,
 * juste le pseudo `ARTEMTEST987` dans le champ login → session créée.
 * Permet de tester la compete depuis n'importe quel navigateur.
 */
app.post('/api/competition/auth/test-login', rateLimit({ windowMs: 10 * 60 * 1000, max: 10, key: 'test-login' }), async (req, res) => {
  if (!ALLOW_TEST_LOGIN) {
    res.status(404).json({ error: 'Indisponible' });
    return;
  }
  const { username } = req.body || {};
  try {
    await competitionManager.refresh();
    const result = await competitionManager.loginTestAccount(String(username || ''));
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Connexion test impossible' });
  }
});

app.post('/api/competition/auth/request', rateLimit({ windowMs: 10 * 60 * 1000, max: 8, key: 'auth-request' }), async (req, res) => {
  const { email, name, intent, phone } = req.body || {};
  const safeIntent = intent === 'signup' ? 'signup' : intent === 'login' ? 'login' : null;
  if (!safeIntent) {
    res.status(400).json({ error: 'intent invalide (signup ou login)' });
    return;
  }
  try {
    // Ensure we have the latest user list (signups from other Lambdas) so the
    // duplicate email/phone checks are accurate.
    await competitionManager.refresh();
    const { code, expiresAt } = await competitionManager.requestOtp({
      email: String(email || ''),
      name: name == null ? undefined : String(name),
      phone: phone == null ? undefined : String(phone),
      intent: safeIntent,
    });

    const result = await sendOtpEmail(String(email || '').trim(), code, safeIntent);

    res.json({
      ok: true,
      email: String(email || '').trim(),
      intent: safeIntent,
      expiresAt,
      delivered: result.delivered,
      deliveryError: result.error,
      // En dev uniquement : si le mail n'a pas pu être livré, on renvoie le
      // code pour ne pas rester bloqué. JAMAIS en production (fuite OTP).
      devCode: (EXPOSE_DEV_OTP && !result.delivered) ? code : undefined,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Demande OTP impossible' });
  }
});

app.post('/api/competition/auth/verify', rateLimit({ windowMs: 10 * 60 * 1000, max: 20, key: 'auth-verify' }), async (req, res) => {
  const { email, code } = req.body || {};
  try {
    await competitionManager.refresh();
    const result = await competitionManager.verifyOtp({
      email: String(email || ''),
      code: String(code || ''),
    });

    // Login -> session immediate
    if ('token' in result) {
      res.json(result);
      return;
    }

    // Signup -> bascule en attente du SMS
    const phoneInfo = await competitionManager.getPendingPhoneInfo(String(email || ''));
    if (!phoneInfo) {
      res.status(500).json({ error: 'Etat OTP incoherent' });
      return;
    }

    const send = await sendSmsOtp(phoneInfo.phone);

    res.json({
      needsPhone: true,
      phoneMasked: result.phoneMasked,
      smsDelivered: send.delivered,
      smsError: send.error,
      // Code SMS exposé seulement hors production ET quand Twilio n'est pas
      // configuré (mode dev). En prod sans Twilio, on ne fuite rien.
      devSmsCode: (EXPOSE_DEV_OTP && !isSmsLive()) ? phoneInfo.localCode : undefined,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Verification impossible' });
  }
});

app.post('/api/competition/auth/verify-phone', rateLimit({ windowMs: 10 * 60 * 1000, max: 20, key: 'auth-verify-phone' }), async (req, res) => {
  const { email, code } = req.body || {};
  const emailStr = String(email || '').trim();
  const codeStr = String(code || '').trim();
  try {
    await competitionManager.refresh();
    const phoneInfo = await competitionManager.getPendingPhoneInfo(emailStr);
    if (!phoneInfo) {
      res.status(400).json({ error: 'Aucune verification SMS en cours' });
      return;
    }

    let approved = false;
    if (isSmsLive()) {
      const check = await checkSmsOtp(phoneInfo.phone, codeStr);
      if (!check.approved) {
        res.status(400).json({ error: check.error || 'Code SMS incorrect' });
        return;
      }
      approved = true;
    }

    const result = await competitionManager.verifyPhoneOtp({
      email: emailStr,
      code: codeStr,
      smsApprovedExternally: approved,
    });
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Verification SMS impossible' });
  }
});

app.post('/api/competition/auth/logout', async (req, res) => {
  const token = getSessionToken(req);
  if (token) await competitionManager.deleteSession(token);
  res.json({ ok: true });
});

app.get('/api/competition/me', async (req, res) => {
  if (IS_SERVERLESS) await competitionManager.refresh();
  const user = await getCompetitionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Session invalide' });
    return;
  }
  res.json({ user });
});

app.patch('/api/competition/me', async (req, res) => {
  const user = await getCompetitionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Session invalide' });
    return;
  }
  try {
    const nextUser = competitionManager.updateUserProfile(user.id, {
      name: req.body?.name,
      phone: req.body?.phone,
      socials: req.body?.socials,
    });
    res.json({ user: nextUser });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Profil impossible a modifier' });
  }
});

app.post('/api/competition/me/avatar', upload.single('avatar'), async (req, res) => {
  const user = await getCompetitionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Session invalide' });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: 'Fichier image requis' });
    return;
  }
  try {
    // Memory storage (Netlify) → buffer is in req.file.buffer.
    // Disk storage (Railway/local) → on relit le fichier puis on le supprime
    // pour garder le blob comme seule source de vérité (Postgres survit
    // aux redéploiements, le disk Railway non).
    let buffer = req.file.buffer;
    if (!buffer && req.file.path) {
      buffer = await fs.promises.readFile(req.file.path);
      fs.promises.unlink(req.file.path).catch(() => undefined);
    }
    if (!buffer || buffer.length === 0) {
      res.status(400).json({ error: 'Fichier image illisible' });
      return;
    }
    const optimized = await optimizeUploadedImage(buffer, { maxSide: 512, quality: 80 });
    const nextUser = await competitionManager.setUserAvatarBlob(
      user.id,
      optimized.mime,
      optimized.buffer,
    );
    invalidateBlobCache(`avatar:${user.id}`);
    // Propage l'avatar à tous les paper players (1 par compétition) pour
    // que `/api/paper/me` renvoie la bonne URL — utilisée par le terminal
    // (TopBar) et le panel leaderboard côté terminal.
    const paperPlayerIds = competitionManager.getPaperPlayerIdsForUser(user.id);
    for (const playerId of paperPlayerIds) {
      manager.setAvatar(playerId, nextUser.avatarUrl || '');
    }
    res.json({ user: nextUser });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Avatar impossible a modifier' });
  }
});

/**
 * Sert l'avatar d'un utilisateur depuis le blob Postgres.
 * Cache long côté navigateur car l'URL contient `?v=<timestamp>` qui
 * change à chaque upload (cf. setUserAvatarBlob), donc pas de stale.
 */
app.get('/api/avatars/:userId', async (req, res) => {
  const userId = String(req.params.userId);
  try {
    await sendImageBlob(
      res,
      `avatar:${userId}`,
      () => competitionManager.getUserAvatarBlob(userId),
      String(req.query.w || ''),
    );
  } catch (error: any) {
    console.error(`[avatars] failed userId=${userId}:`, error?.message);
    res.status(500).json({ error: error.message || 'Lecture impossible' });
  }
});

app.post('/api/admin/prize-image', requireAdmin, upload.single('image'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Fichier image requis' });
    return;
  }
  try {
    let buffer = req.file.buffer;
    if (!buffer && req.file.path) {
      buffer = await fs.promises.readFile(req.file.path);
      fs.promises.unlink(req.file.path).catch(() => undefined);
    }
    if (!buffer || buffer.length === 0) {
      res.status(400).json({ error: 'Fichier image illisible' });
      return;
    }
    const optimized = await optimizeUploadedImage(buffer, { maxSide: 960, quality: 82 });
    const id = crypto.randomUUID();
    await competitionManager.putPrizeImage(id, optimized.mime, optimized.buffer);
    invalidateBlobCache(`prize:${id}`);
    res.json({ imageUrl: `/api/prize-images/${id}?v=${Date.now()}` });
  } catch (error: any) {
    console.error('[prize-image] upload failed:', error?.message);
    res.status(500).json({ error: error.message || 'Upload impossible' });
  }
});

app.get('/api/prize-images/:id', async (req, res) => {
  const id = String(req.params.id);
  try {
    await sendImageBlob(
      res,
      `prize:${id}`,
      () => competitionManager.getPrizeImage(id),
      String(req.query.w || ''),
    );
  } catch (error: any) {
    console.error(`[prize-image] read failed id=${id}:`, error?.message);
    res.status(500).json({ error: error.message || 'Lecture impossible' });
  }
});

/**
 * Lightweight finalize-only sync. Fast in the common case (no ended
 * competitions) and unavoidable: orders must close at competition end. We
 * skip the per-player PnL push since trades and position closes already
 * keep the paper player state in sync.
 */
async function maybeFinalizeEndedCompetitions(): Promise<void> {
  if (!competitionManager.hasCompetitionsNeedingFinalization()) return;
  await finalizeEndedCompetitions();
}

app.get('/api/competition/public', async (_req, res) => {
  await maybeFinalizeEndedCompetitions();
  res.json({ competitions: competitionManager.listPublicCompetitions() });
});

app.get('/api/competition/mine', async (req, res) => {
  const user = await getCompetitionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Session invalide' });
    return;
  }
  await maybeFinalizeEndedCompetitions();
  res.json({ competitions: competitionManager.listUserCompetitions(user.id) });
});

/**
 * Fast single-round-trip bootstrap used by the frontend on page load.
 * Returns the public competitions (always) plus the authenticated user and
 * their own competitions when a Bearer token is provided. Avoiding three
 * separate Lambda invocations dramatically reduces the perceived load time
 * on Netlify (each cold start is ~1-3s).
 */
app.get('/api/competition/bootstrap', async (req, res) => {
  if (IS_SERVERLESS) await competitionManager.refresh();
  const [user] = await Promise.all([
    getCompetitionUser(req),
    maybeFinalizeEndedCompetitions(),
  ]);
  const publicCompetitions = competitionManager.listPublicCompetitions();
  const myCompetitions = user ? competitionManager.listUserCompetitions(user.id) : [];
  res.json({
    user,
    publicCompetitions,
    myCompetitions,
  });
});

app.post('/api/competition/join', async (req, res) => {
  const user = await getCompetitionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Session invalide' });
    return;
  }
  try {
    // Refresh first so we don't miss a competition that was just created on
    // another Lambda, then persist the join atomically before responding so
    // the next click ("Trader") sees the entry on any Lambda.
    await competitionManager.refresh();
    const competition = competitionManager.joinCompetition(user.id, String(req.body?.code || ''));
    await competitionManager.persist();
    res.json({ ok: true, competitionId: competition.id });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Join impossible' });
  }
});

app.post('/api/competition/trade/session', async (req, res) => {
  const user = await getCompetitionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Session invalide' });
    return;
  }

  const competitionId = String(req.body?.competitionId || '');
  if (!competitionId) {
    res.status(400).json({ error: 'competitionId requis' });
    return;
  }

  try {
    // On serverless we always need to merge state from sibling Lambdas.
    // On a persistent Node server the in-memory state is the source of
    // truth, so we skip the round-trip and answer instantly.
    if (IS_SERVERLESS) {
      await competitionManager.refresh();
      await refreshManagerState();
    }
    await finalizeEndedCompetitions();
    const { competition, entry } = competitionManager.getCompetitionForUser(competitionId, user.id);
    competitionManager.assertCompetitionTradingOpen(competition.id);
    if (competition.executionMode === 'real') {
      res.status(400).json({ error: 'Le mode reel de la competition n est pas encore disponible dans ce terminal' });
      return;
    }

    let player: ReturnType<typeof manager.getPlayerById> = null;
    if (entry.paperPlayerId) {
      player = manager.getPlayerById(entry.paperPlayerId);
    }

    if (!player) {
      player = manager.registerPlayer(user.name, '', '');
      competitionManager.linkPaperPlayer(competition.id, user.id, player.id);
    }

    const ready = await manager.setupCompetitionPaperPlayer(player.id);
    if (!ready) {
      res.status(500).json({ error: 'Initialisation joueur impossible' });
      return;
    }
    player = ready;

    const token = crypto.randomBytes(24).toString('hex');
    // setTraderSession writes a dedicated row in comp_trader_sessions and
    // persistPlayer writes the player to its own row in comp_paper_players,
    // so concurrent writes from other Lambdas can no longer wipe either of
    // them. We also persist the competition blob so the entry's
    // paperPlayerId link survives a cold start on the next request.
    if (IS_SERVERLESS) {
      // Awaiting these on serverless is mandatory to survive cold starts.
      await Promise.all([
        competitionManager.setTraderSession(token, player.id, competition.id),
        manager.persistPlayer(player.id),
        competitionManager.persist(),
      ]);
    } else {
      // The trader session is the only thing the very next request strictly
      // needs (so /api/paper/me does not 401). The other writes can run in
      // the background, which shaves another DB round-trip off this endpoint.
      await competitionManager.setTraderSession(token, player.id, competition.id);
      void manager.persistPlayer(player.id);
      void competitionManager.persist();
    }
    await syncCompetitionResultForPlayer(player.id);

    const { apiKey: _k, apiSecret: _s, ...publicPlayer } = player;
    // Build the same payload shape /api/paper/me returns so the frontend
    // can render the terminal immediately on mount, with no extra round
    // trip and no flash of the "Acces requis" placeholder.
    const competitionStatus = competitionManager.getCompetitionStatus(competition.id);
    const competitionContext = competitionManager.getCompetitionContextForPaperPlayer(competition.id, player.id) || {
      id: competition.id,
      title: competition.title,
      executionMode: competition.executionMode,
    };

    res.json({
      token,
      player: publicPlayer,
      market: manager.getChartMarketSnapshot(),
      fees: manager.getPaperFeeRates(),
      pairs: manager.getSupportedPaperPairs(),
      startingBalance: manager.getCompetitionStartingBalance(),
      marketDataSource: manager.getMarketDataSource(),
      eventStarted: manager.isStarted(),
      canTrade: competitionStatus === 'live',
      competition: competitionContext,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Session de trading competition impossible' });
  }
});

app.get('/api/competition/leaderboard/:id', async (req, res) => {
  try {
    await syncAllCompetitionResults();
    const data = competitionManager.getPublicLeaderboard(String(req.params.id || ''));
    res.json(data);
  } catch (error: any) {
    res.status(404).json({ error: error.message || 'Leaderboard introuvable' });
  }
});

// --- Admin APIs for competitions ---

/**
 * Réglages des arènes online (compete) — STRICTEMENT séparés de la config de
 * l'événement LIVE (`/api/event/config`). Régler la balance compete ne doit
 * jamais toucher l'événement LIVE et inversement.
 */
app.get('/api/competition/arena-config', requireAdmin, (_req, res) => {
  res.json({ startingBalance: competitionManager.getCompetitionStartingBalance() });
});

app.post('/api/competition/arena-config', requireAdmin, async (req, res) => {
  const startingBalance = Number(req.body?.startingBalance);
  if (!Number.isFinite(startingBalance) || startingBalance <= 0) {
    res.status(400).json({ error: 'Balance arène invalide' });
    return;
  }
  try {
    await competitionManager.setCompetitionStartingBalance(startingBalance);
    manager.setCompetitionStartingBalance(startingBalance);
    res.json({ ok: true, startingBalance: competitionManager.getCompetitionStartingBalance() });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Réglage arène impossible' });
  }
});

app.get('/api/admin/competitions', requireAdmin, async (_req, res) => {
  await syncAllCompetitionResults();
  res.json({ competitions: competitionManager.listAdminCompetitions() });
});

app.post('/api/admin/competitions', requireAdmin, async (req, res) => {
  const { title, code, executionMode, startAt, endAt, isPublic, cashPrize } = req.body || {};
  try {
    const competition = competitionManager.createCompetition({
      title: String(title || ''),
      code: String(code || ''),
      executionMode: executionMode === 'real' ? 'real' : 'paper',
      startAt: Number(startAt),
      endAt: Number(endAt),
      isPublic: Boolean(isPublic),
      cashPrize,
    });
    await competitionManager.persist();
    res.json({ ok: true, competition });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Creation competition impossible' });
  }
});

app.patch('/api/admin/competitions/:id', requireAdmin, async (req, res) => {
  const body = req.body || {};
  const { title, code, executionMode, startAt, endAt, isPublic, cashPrize } = body;
  try {
    const patch: Record<string, unknown> = {};
    if (title !== undefined) patch.title = String(title);
    if (code !== undefined) patch.code = String(code);
    if (executionMode !== undefined) patch.executionMode = executionMode === 'real' ? 'real' : 'paper';
    if (startAt !== undefined) patch.startAt = Number(startAt);
    if (endAt !== undefined) patch.endAt = Number(endAt);
    if (isPublic !== undefined) patch.isPublic = Boolean(isPublic);
    if ('cashPrize' in body) patch.cashPrize = cashPrize;

    const competition = competitionManager.updateCompetition(String(req.params.id || ''), patch);
    await competitionManager.persist();
    res.json({ ok: true, competition });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Mise a jour competition impossible' });
  }
});

app.delete('/api/admin/competitions/:id', requireAdmin, async (req, res) => {
  try {
    const { paperPlayerIds } = competitionManager.deleteCompetition(String(req.params.id || ''));

    manager.unmarkOnlineCompetitionPlayers(paperPlayerIds);
    for (const playerId of paperPlayerIds) {
      await competitionManager.deleteTraderSessionsForPlayer(playerId);
      manager.removePlayer(playerId);
    }
    await competitionManager.persist();
    res.json({ ok: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Suppression competition impossible' });
  }
});

app.post('/api/admin/competitions/result', requireAdmin, async (req, res) => {
  const { competitionId, userId, pnlUsd, pnlPercent, tradesCount } = req.body || {};
  try {
    competitionManager.upsertResult({
      competitionId: String(competitionId || ''),
      userId: String(userId || ''),
      pnlUsd: Number(pnlUsd),
      pnlPercent: Number(pnlPercent),
      tradesCount: Number(tradesCount),
    });
    await competitionManager.persist();
    res.json({ ok: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Mise a jour resultat impossible' });
  }
});

const serverReady = Promise.all([
  competitionManager.ready,
  manager.ready,
  itickCandles.initItickCandlesStore(),
]).then(async () => {
  resyncCompetitionPlayerIsolation();
  // Pousse la balance des arènes online (persistée côté compétition) dans le
  // PlayerManager pour qu'elle soit indépendante de l'événement LIVE.
  manager.setCompetitionStartingBalance(competitionManager.getCompetitionStartingBalance());
  await manager.ensurePublicMarketFeed();
});

if (!process.env.NETLIFY) {
  serverReady.then(() => {
    server.listen(PORT, () => {
      console.log(`BTF Server running on http://localhost:${PORT}`);
      // Préchauffer le top des pairs crypto avec le **fast path** (1500
      // bars chacun = 1 round-trip Binance ~300 ms). Le background fill
      // jusqu'à 40k bars se déclenche ensuite tout seul dans
      // `engineCandlesCache.startFetch`. On garde une liste réduite pour
      // ne pas saturer le rate limit Binance Futures (~1200 req/min) au
      // boot Railway.
      engineCandlesCache.prewarm(
        [
          { pair: 'BTC/USD', source: 'binance' },
          { pair: 'ETH/USD', source: 'binance' },
          { pair: 'SOL/USD', source: 'binance' },
          { pair: 'XRP/USD', source: 'binance' },
          { pair: 'BNB/USD', source: 'binance' },
        ],
        [1],
      );

      // Démarrage du pipeline iTick : subscribe aux 11 instruments prod,
      // branche le live tick → candle builder, lance le backfill
      // historique en background, et alimente le paper engine.
      // Plan pro = 600 calls/min, 6 WS, 500 subs.
      if (itick.isConfigured()) {
        // Enregistre les pairs crypto pour le mapping code↔pair du bridge,
        // puis ajoute le cluster crypto (region BA = spot Binance =
        // TradingView) aux subscriptions forex/indices.
        registerItickCrypto(CRYPTO_LIVE_PAIRS);
        const subs = itickSymbolsByAsset();
        const cryptoCodeList = itickCryptoCodes();
        if (cryptoCodeList.length > 0) subs.crypto = cryptoCodeList;
        itick.itickFeed.setSubscriptions(subs);
        itickCandles.startLiveBuilder();
        startItickToPaperBridge(
          (quotes) => manager.applyItickMarketTicks(quotes),
          (pairs) => broadcastMarketTicks(pairs),
        );
        const summary = Object.entries(subs)
          .map(([asset, codes]) => `${asset}:${codes?.length ?? 0}`)
          .join(' ');
        console.log(`[itick] feed armé — ${summary}`);
      } else {
        console.warn('[itick] ITICK_TOKEN absent — feed désactivé');
      }
    });

    // Ferme proprement la connexion WS iTick au shutdown (tsx watch
    // reload, Ctrl-C, etc.) pour que iTick libère immédiatement la
    // session — sinon la nouvelle instance est refusée pendant ~30s.
    const gracefulShutdown = (signal: string) => {
      console.log(`[shutdown] ${signal} reçu, fermeture iTick…`);
      try { itick.itickFeed.disconnect(); } catch { /* noop */ }
      try { manager.shutdownMarketFeed(); } catch { /* noop */ }
      setTimeout(() => process.exit(0), 250);
    };
    process.once('SIGINT', () => gracefulShutdown('SIGINT'));
    process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
  });
}

// Catch-all: log unhandled rejections instead of letting Node 22 crash the
// process. Most rejections come from background fetches (Binance prewarm,
// stale-revalidate) where the user request has already been served.
process.on('unhandledRejection', (reason) => {
  console.warn('[unhandledRejection]', reason);
});

export { serverReady };
export default app;
