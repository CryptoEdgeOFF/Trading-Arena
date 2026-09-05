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
import { EventConfig, StatePatch, type Trade } from './types.js';
import * as kraken from './kraken.js';
import type { OhlcCandle } from './kraken.js';
import * as binance from './binance.js';
import * as cryptoCandles from './cryptoCandles.js';
import { pairToBinanceSymbol } from './binance.js';
import * as hyperliquid from './hyperliquid.js';
import * as engineCandlesCache from './engineCandlesCache.js';
import * as cryptoCandlesStore from './cryptoCandlesStore.js';
import * as itick from './itick.js';
import * as itickCandles from './itickCandles.js';
import { ITICK_INSTRUMENTS, findByPair as findItickByPair, symbolsByAsset as itickSymbolsByAsset, isItickPair, registerItickCrypto, cryptoCodes as itickCryptoCodes } from './itickInstruments.js';
import { startItickToPaperBridge } from './itickToPaperBridge.js';
import { configureLiveMarketNeed, isLiveMarketNeeded } from './liveMarketNeeded.js';
import { getPaperPairDefinition, CRYPTO_LIVE_PAIRS } from './exchangePaperEngine.js';
import { CompetitionManager, inferSeasonStatus } from './competitionManager.js';
import { CompetitionNotifier } from './competitionNotifications.js';
import { computeTradeStats, type TradeStats } from './tradeStats.js';
import { sendOtpEmail, sendNotificationEmail, sendNewArenaEmail, sendPrizeWinnerEmail, sendPayoutRequestSubmittedEmail, sendPayoutRequestAdminEmail, sendPayoutApprovedEmail, PRIZE_CONTACT_EMAIL, isEmailTestFilterActive } from './mailer.js';
import {
  getEmailSettings,
  updateEmailSettings,
  listEmailLog,
  getEmailPoolStats,
  EMAIL_CATALOG,
  EMAIL_KINDS,
  type EmailKind,
  type EmailSettingsPatch,
} from './emailSettingsStore.js';
import { checkSmsOtp, isSmsLive, sendSmsOtp } from './smsSender.js';
import { getMarketMetadata, getMarketMetadataPoolStats } from './marketMetadata.js';
import * as promotionsStore from './promotionsStore.js';
import * as newsStore from './newsStore.js';
import {
  CompetitionPushNotifier,
  describePushForUser,
  isPushConfigured,
  registerPushDevice,
  sendPushToAllDevices,
  sendPushToUser,
  unregisterAllPushDevices,
  unregisterPushDevice,
} from './pushNotifications.js';
import { optimizeUploadedImage, transparentizeWhiteBackground } from './imageOptimize.js';
import { invalidateBlobCache } from './blobCache.js';
import { sendImageBlob } from './serveImageBlob.js';
import {
  anonymizeChatForUser,
  blockChatUser,
  createGlobalChatMessage,
  getChatImage,
  listBlockedChatUserIds,
  listGlobalChatMessages,
  putChatImage,
  reportGlobalChatMessage,
  unblockChatUser,
  type ChatReportReason,
} from './globalChatStore.js';
import { deleteUserRating, getRatingLeaderboard, getRatingSnapshots, syncManyUserRatings, syncUserRating } from './ratingStore.js';
import { getPnlHistory, getPnlHistoryWithLivePoint, getPnlMoments, hasPnlHistory, maybeRecordPnlSample, prunePnlHistories, reconstructPnlHistoryFromTrades, setPnlHistoryPersistHandler, slimPublicPnlHistory } from './pnlHistoryStore.js';
import { countryFromPhone } from './phoneCountry.js';
import { ensureScheduledArenas } from './arenaScheduler.js';
import { renderPublicSpectatePage } from './publicSpectatePage.js';
import { buildTradingPushPayload, shouldNotifyCompletedLimit, shouldSendNewsPush, tradingClosePushKind } from './notificationRules.js';

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const MODERATION_CONTACT_EMAIL = (
  process.env.MODERATION_EMAIL
  || process.env.PRIZE_CONTACT_EMAIL
  || 'contact.cryptoedge@gmail.com'
).trim();
// permessage-deflate compresses every WS frame natively. With state:patch
// payloads being mostly repetitive JSON keys, gzip typically yields a 3-5x
// reduction on the wire. We tune it to favor latency over CPU: small window,
// no compression for tiny frames, and an explicit memory budget so a burst
// of 500+ clients does not blow up RAM.
const wss = new WebSocketServer({
  noServer: true,
  // perMessageDeflate DÉSACTIVÉ volontairement : la compression zlib alloue de
  // la mémoire native (hors heap V8) qui se fragmente et s'accumule sous fort
  // débit de messages. Avec nos broadcasts continus (~100 ms) de petits diffs,
  // le gain de compression est négligeable mais la RAM native grimpe jusqu'à
  // l'OOM (observé : ~12 Go/jour, chute au redeploy). Voir doc `ws` :
  // « The extension adds a significant overhead in terms of memory consumption ».
  perMessageDeflate: false,
});

// Canal WS isolé pour /feed-test : forward des ticks iTick live aux
// navigateurs sans toucher au pipeline /ws principal (compétition).
const itickWss = new WebSocketServer({ noServer: true });
const chatWss = new WebSocketServer({ noServer: true });
const WS_MAX_BUFFERED_BYTES = Math.max(64 * 1024, Number(process.env.WS_MAX_BUFFERED_BYTES) || 1024 * 1024);

/**
 * Ne laisse jamais un navigateur lent accumuler une file WebSocket sans
 * limite en RAM. Le client se reconnectera et recevra un snapshot frais.
 */
function sendWs(ws: WebSocket, payload: string): boolean {
  if (ws.readyState !== WebSocket.OPEN) return false;
  if (ws.bufferedAmount > WS_MAX_BUFFERED_BYTES) {
    ws.terminate();
    return false;
  }
  try {
    ws.send(payload);
    return true;
  } catch {
    return false;
  }
}

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
  } else if (pathname === '/ws/chat') {
    chatWss.handleUpgrade(req, socket, head, (ws) => chatWss.emit('connection', ws, req));
  } else if (pathname === '/ws/itick') {
    itickWss.handleUpgrade(req, socket, head, (ws) => itickWss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});
const itickClients = new Set<WebSocket>();
// Clients chat → salle (null = chat global, sinon id d'arène). Les salles
// d'arène sont ouvertes à tout utilisateur connecté, spectateurs compris.
const chatClients = new Map<WebSocket, string | null>();
itickWss.on('connection', (ws) => {
  itickClients.add(ws);
  (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
  ws.on('pong', () => {
    (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
  });
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
if (!process.env.NETLIFY) {
  const itickHeartbeat = setInterval(() => {
    itickWss.clients.forEach((ws) => {
      const sock = ws as WebSocket & { isAlive?: boolean };
      if (sock.isAlive === false) {
        ws.terminate();
        return;
      }
      sock.isAlive = false;
      try {
        ws.ping();
      } catch {
        // noop
      }
    });
  }, Number(process.env.WS_HEARTBEAT_MS) || 30_000);
  itickHeartbeat.unref?.();
}
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
    const allowedExt = /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i;
    const allowedMime = /^image\/(jpeg|png|gif|webp|heic|heif)$/i;
    cb(null, allowedExt.test(path.extname(file.originalname)) || allowedMime.test(file.mimetype));
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

// Garde-fou global anti-abus/DDoS sur /api : plafond généreux par IP (le temps
// réel passe par WebSocket, donc le REST ne fait que du polling léger). Bloque
// les scripts qui martèlent des centaines de requêtes/seconde. /api/health est
// exempté pour ne jamais bloquer le healthcheck de la plateforme.
const GLOBAL_API_WINDOW_MS = Number(process.env.GLOBAL_RATE_WINDOW_MS) || 60_000;
const GLOBAL_API_MAX = Number(process.env.GLOBAL_RATE_MAX) || 600;
const globalApiLimiter = rateLimit({ windowMs: GLOBAL_API_WINDOW_MS, max: GLOBAL_API_MAX, key: 'global-api' });
app.use('/api', (req, res, next) => {
  if (req.path === '/health') {
    next();
    return;
  }
  globalApiLimiter(req, res, next);
});

const MAX_PUBLIC_CANDLES = 4000;
function parseCandleLimit(raw: unknown, fallback = 500): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(MAX_PUBLIC_CANDLES, Math.floor(value));
}

app.use((req, res, next) => {
  res.on('finish', () => {
    const length = Number(res.getHeader('content-length') || 0);
    if (length >= 200_000) {
      console.warn(`[egress] ${req.method} ${req.originalUrl} ${res.statusCode} ${length}B ip=${req.ip}`);
    }
  });
  next();
});

app.use('/uploads', express.static(UPLOADS_DIR));
// Ne plus servir les médias du site depuis Railway : aftermovie, WAV, PNG
// lourds partaient en egress ($0,05/Go). Le site les a déjà sur Netlify.
const PUBLIC_SITE_URL = (process.env.APP_PUBLIC_URL || 'https://btfarena.com').replace(/\/$/, '');
app.use('/assets', (req, res) => {
  res.redirect(301, `${PUBLIC_SITE_URL}${req.originalUrl}`);
});
app.use('/news', (req, res) => {
  res.redirect(301, `${PUBLIC_SITE_URL}${req.originalUrl}`);
});
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
setPnlHistoryPersistHandler((competitionId, snapshot) => {
  competitionManager.setPnlRace(competitionId, snapshot);
});
const pushRuntimeStartedAt = Date.now();
const pushedTradeIds = new Set<string>();
chatWss.on('connection', (ws, req) => {
  (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
  ws.on('pong', () => {
    (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
  });
  const url = new URL(req.url || '/ws/chat', `http://${req.headers.host || 'localhost'}`);
  const token = url.searchParams.get('token') || '';
  const room = String(url.searchParams.get('competitionId') || '').trim() || null;
  void competitionManager.getUserFromToken(token).then((user) => {
    if (!user || ws.readyState !== WebSocket.OPEN) {
      ws.close(1008, 'Session invalide');
      return;
    }
    chatClients.set(ws, room);
    ws.send(JSON.stringify({ type: 'chat:ready', data: { userId: user.id } }));
    const sentAt: number[] = [];
    ws.on('message', (raw) => {
      let payload: { type?: string; data?: { body?: unknown; replyToId?: unknown; imageUrl?: unknown; clientId?: unknown } };
      try {
        payload = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (payload.type !== 'chat:send') return;
      const now = Date.now();
      while (sentAt.length && now - sentAt[0] > 60_000) sentAt.shift();
      const clientId = String(payload.data?.clientId || '').slice(0, 100);
      if (sentAt.length >= 20) {
        ws.send(JSON.stringify({ type: 'chat:error', data: { clientId, error: 'Trop de messages, attends quelques secondes.' } }));
        return;
      }
      sentAt.push(now);
      void createGlobalChatMessage(user, {
        body: payload.data?.body,
        replyToId: payload.data?.replyToId,
        imageUrl: payload.data?.imageUrl,
        competitionId: room,
      }).then((message) => {
        broadcastGlobalChatMessage(message, clientId);
        notifyGlobalChatReply(user, message);
      }).catch((error) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'chat:error', data: { clientId, error: (error as Error).message || 'Message invalide' } }));
        }
      });
    });
  }).catch(() => ws.close(1011, 'Authentification impossible'));
  ws.on('close', () => chatClients.delete(ws));
});

function broadcastGlobalChatMessage(message: Awaited<ReturnType<typeof createGlobalChatMessage>>, clientId?: string): void {
  const payload = JSON.stringify({ type: 'chat:message', data: { ...message, ...(clientId ? { clientId } : {}) } });
  const room = message.competitionId || null;
  for (const [ws, clientRoom] of chatClients) {
    if (clientRoom === room && ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

function notifyGlobalChatReply(
  user: NonNullable<Awaited<ReturnType<typeof competitionManager.getUserFromToken>>>,
  message: Awaited<ReturnType<typeof createGlobalChatMessage>>,
): void {
  if (!message.replyTo || message.replyTo.userId === user.id) return;
  void sendPushToUser(message.replyTo.userId, {
    title: `${user.name} t’a répondu`,
    body: message.body
      ? (message.body.length > 110 ? `${message.body.slice(0, 107)}…` : message.body)
      : '📷 Photo',
    kind: 'chat_reply',
    data: { messageId: message.id, replyToId: message.replyTo.id },
  });
}
let finalizingEndedCompetitions: Promise<void> | null = null;
type PaperClientSubscription = {
  token: string;
  playerId: string;
  competitionId: string | null;
  lastPayload: ReturnType<typeof buildPaperUpdatePayload> | null;
};
const paperClients = new Map<WebSocket, PaperClientSubscription>();
const marketSubscriptions = new Map<WebSocket, Set<string>>();
const MARKET_WATCH_MS = 2_000;
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
const arenaCompetitionSnapshots = new Map<string, string>();

// --- Admin auth (single shared code, configurable via env) ---
// Aucun fallback en dur : si ADMIN_CODE n'est pas défini, l'accès admin est
// désactivé (fail-closed) plutôt que d'exposer un code par défaut connu.
const ADMIN_CODE = (process.env.ADMIN_CODE || '').trim();
if (!ADMIN_CODE) {
  console.warn('[admin] ADMIN_CODE non défini — login admin désactivé jusqu’à sa configuration.');
}

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const MOBILE_STAGING_TEST_MODE = process.env.MOBILE_STAGING_TEST_MODE === 'true';
// Le compte de test (ARTEMTEST987) bypasse l'OTP : il ne doit JAMAIS être
// actif en production sauf activation explicite via ALLOW_TEST_LOGIN=true.
const ALLOW_TEST_LOGIN = MOBILE_STAGING_TEST_MODE || process.env.ALLOW_TEST_LOGIN === 'true' || !IS_PRODUCTION;
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
    // Un terminal paper reçoit déjà market:tick + paper:patch + arena:patch.
    // Lui renvoyer aussi le patch du dashboard global dupliquerait le marché.
    if (!paperClients.has(ws)) sendWs(ws, msg);
  });
  syncAndBroadcastPaperRuntime();
});

function syncAndBroadcastPaperRuntime(): void {
  // Sync online-competition (paper) traders whose PnL changed into their
  // competition.entries before pushing arena diffs. This also propagates
  // order-only partial-fill progress, even though competition players are
  // intentionally absent from the public state patch.
  const dirtyPaperPlayers = manager.drainDirtyPaperPlayers();
  for (const player of dirtyPaperPlayers) {
    const update = competitionManager.updatePaperResultByPlayerId(player.id, {
      pnlUsd: player.pnl,
      pnlPercent: player.pnlPercent,
      tradesCount: player.tradeCount,
      equity: player.currentBalance,
    });
    if (update?.drawdownWarning) void sendDrawdownWarning(update);
    void sendTradingPushNotifications(player);
  }
  broadcastPaperUpdates();
}

manager.setMarketTickBroadcaster((pairs) => broadcastMarketTicks(pairs));
manager.setPaperRuntimeUpdateHandler(syncAndBroadcastPaperRuntime);
manager.setTradingUnlockHandler(() => broadcastPaperUpdates());

async function sendTradingPushNotifications(player: NonNullable<ReturnType<typeof manager.getPlayerById>>): Promise<void> {
  const context = competitionManager.getPushContextForPaperPlayer(player.id);
  if (!context) {
    console.warn(`[push] skip SL/TP: pas de contexte compétition pour ${player.id}`);
    return;
  }
  const recentTrades = (player.trades || []).slice(-12);
  for (const trade of recentTrades) {
    if (trade.time < pushRuntimeStartedAt - 5_000 || pushedTradeIds.has(trade.id)) continue;
    if (trade.action !== 'open' && trade.closeReason !== 'stop-loss' && trade.closeReason !== 'take-profit') continue;
    pushedTradeIds.add(trade.id);
    if (trade.action === 'open') {
      const openOrderIds = new Set(player.openOrders.map((order) => order.id));
      if (!shouldNotifyCompletedLimit(trade, openOrderIds)) continue;
      const parentOrderId = trade.orderId || trade.id;
      const payload = buildTradingPushPayload({
        kind: 'order_filled',
        pair: trade.pair,
        side: trade.side,
        price: trade.price,
      });
      await sendPushToUser(context.userId, {
        ...payload,
        competitionId: context.competitionId,
        data: { pair: trade.pair, price: trade.price, side: trade.side, orderId: parentOrderId },
      });
      continue;
    }
    const closeKind = tradingClosePushKind(trade.closeReason);
    if (!closeKind) continue;
    const payload = buildTradingPushPayload({
      kind: closeKind,
      pair: trade.pair,
      price: trade.price,
      pnl: trade.pnl,
    });
    await sendPushToUser(context.userId, {
      ...payload,
      competitionId: context.competitionId,
      data: { pair: trade.pair, price: trade.price, pnl: trade.pnl },
    });
  }
  if (pushedTradeIds.size > 20_000) pushedTradeIds.clear();
}

async function sendDrawdownWarning(update: {
  competitionId: string;
  drawdownWarning?: {
    userId: string;
    competitionTitle: string;
    equity: number;
    limitEquity: number;
  };
}): Promise<void> {
  const warning = update.drawdownWarning;
  if (!warning) return;
  const remaining = Math.max(0, warning.equity - warning.limitEquity);
  const payload = buildTradingPushPayload({
    kind: 'drawdown_warning',
    competitionTitle: warning.competitionTitle,
    remaining,
  });
  await sendPushToUser(warning.userId, {
    ...payload,
    competitionId: update.competitionId,
    data: {
      equity: warning.equity,
      limitEquity: warning.limitEquity,
      remaining,
    },
  });
}

type MarketTick = {
  pair: string;
  markPrice: number;
  bidPrice?: number;
  askPrice?: number;
  updatedAt?: number;
  marketOpen?: boolean;
  marketClosedLabel?: string | null;
  change24h?: number | null;
};

function buildMarketTicks(pairs: string[]): MarketTick[] {
  const market = manager.getPaperMarketSnapshot();
  return pairs
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
}

function sendMarketTicks(ws: WebSocket, ticks: MarketTick[]): void {
  if (ticks.length === 0) return;
  sendWs(ws, JSON.stringify({ type: 'market:tick', data: { ticks } }));
}

function applyMarketSubscribe(ws: WebSocket, pairs: unknown): void {
  const next = new Set(
    (Array.isArray(pairs) ? pairs : [])
      .map((pair) => String(pair || '').trim().toUpperCase())
      .filter((pair) => /^[A-Z0-9]{2,10}\/[A-Z0-9]{2,10}$/.test(pair))
      .slice(0, 24),
  );
  marketSubscriptions.set(ws, next);
  sendMarketTicks(ws, buildMarketTicks([...next]));
}

function broadcastMarketTicks(pairs: string[]): void {
  if (pairs.length === 0 || clients.size === 0) return;
  const ticks = buildMarketTicks(pairs);
  if (ticks.length === 0) return;
  const allMsg = JSON.stringify({ type: 'market:tick', data: { ticks } });
  clients.forEach((ws) => {
    if (paperClients.has(ws)) {
      const wanted = marketSubscriptions.get(ws);
      if (!wanted || wanted.size === 0) return;
      sendMarketTicks(ws, ticks.filter((tick) => wanted.has(tick.pair)));
      return;
    }
    sendWs(ws, allMsg);
  });
}

function broadcastMarketWatch(): void {
  if (paperClients.size === 0) return;
  const quotes = Object.values(manager.getChartMarketSnapshot()).map((ticker) => ({
    pair: ticker.pair,
    markPrice: ticker.markPrice,
    bidPrice: ticker.bidPrice,
    askPrice: ticker.askPrice,
    change24h: ticker.change24h ?? null,
    marketOpen: ticker.marketOpen,
    updatedAt: ticker.updatedAt,
  }));
  if (quotes.length === 0) return;
  const msg = JSON.stringify({ type: 'market:watch', data: { quotes } });
  paperClients.forEach((_sub, ws) => sendWs(ws, msg));
}

const CRYPTO_PREWARM_PAIRS = [
  { pair: 'BTC/USD', source: 'binance' as const },
  { pair: 'ETH/USD', source: 'binance' as const },
  { pair: 'SOL/USD', source: 'binance' as const },
  { pair: 'XRP/USD', source: 'binance' as const },
  { pair: 'BNB/USD', source: 'binance' as const },
  { pair: 'TRX/USD', source: 'binance' as const },
];

let marketFeedsArmed = false;
let itickHistoricalBackfillStarted = false;

configureLiveMarketNeed({
  competitionNeed: () => competitionManager.needsLiveMarketData(),
  extraNeed: () => manager.isStarted() || !IS_PRODUCTION,
});

function armItickSubscriptions(): void {
  if (!itick.isConfigured()) {
    console.warn('[itick] ITICK_TOKEN absent — feed désactivé');
    return;
  }
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
  if (!itickHistoricalBackfillStarted) {
    itickHistoricalBackfillStarted = true;
    void itickCandles.backfillAll().catch((err) => {
      console.warn('[itickCandles] backfillAll KO:', (err as Error).message);
    });
  }
  const summary = Object.entries(subs)
    .map(([asset, codes]) => `${asset}:${codes?.length ?? 0}`)
    .join(' ');
  console.log(`[itick] feed armé — ${summary}`);
}

async function startLiveMarketFeeds(): Promise<void> {
  await manager.ensurePublicMarketFeed();
  engineCandlesCache.prewarm(CRYPTO_PREWARM_PAIRS, [1, 5, 15]);
  armItickSubscriptions();
}

function stopLiveMarketFeeds(): void {
  try { itick.itickFeed.setSubscriptions({}); } catch { /* noop */ }
  try { itick.itickFeed.disconnect(); } catch { /* noop */ }
  try { manager.pausePublicMarketFeed(); } catch { /* noop */ }
}

async function syncLiveMarketFeeds(): Promise<void> {
  const needed = isLiveMarketNeeded();
  if (needed && !marketFeedsArmed) {
    marketFeedsArmed = true;
    console.log('[market] feeds ON — arène live ou départ dans moins de 10 min');
    await startLiveMarketFeeds();
  } else if (!needed && marketFeedsArmed) {
    marketFeedsArmed = false;
    console.log('[market] feeds OFF — aucune compétition en cours');
    stopLiveMarketFeeds();
  }
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
  if (!isLiveMarketNeeded()) {
    res.set('Cache-Control', 'public, max-age=15');
    res.json({ candles: [], pair: req.query.pair || null, source: 'idle' });
    return;
  }
  try {
    const interval = Number(req.query.interval || 1);
    const limit = parseCandleLimit(req.query.limit || req.query.countBack, 500);
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
      res.set(
        'Cache-Control',
        to
          ? 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600'
          : 'public, max-age=5, s-maxage=5, stale-while-revalidate=20',
      );
      res.json({ candles: bars, pair: inst.pair, asset: inst.asset });
      return;
    }

    // Mode 2 : raw code (legacy /feed-test)
    const code = String(req.query.code || 'EURUSD').toUpperCase();
    const asset = parseAsset(req.query.asset);
    const bars = await itick.getKline(code, interval, limit, endTs, asset);
    res.set(
      'Cache-Control',
      to
        ? 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600'
        : 'public, max-age=5, s-maxage=5, stale-while-revalidate=20',
    );
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

/** Coalesce les syncs leaderboard : 1 recalc / compétition / 2s max (aligné poll front). */
const LEADERBOARD_SYNC_MS = 2000;
const leaderboardSyncState = new Map<string, { lastAt: number; inflight: Promise<void> | null }>();

async function syncCompetitionResultsForCompetition(competitionId: string): Promise<void> {
  await maybeFinalizeEndedCompetitions();

  let state = leaderboardSyncState.get(competitionId);
  if (!state) {
    state = { lastAt: 0, inflight: null };
    leaderboardSyncState.set(competitionId, state);
  }

  if (state.inflight) {
    await state.inflight;
    return;
  }

  const now = Date.now();
  if (now - state.lastAt < LEADERBOARD_SYNC_MS) {
    return;
  }

  const playerIds = competitionManager.getPaperPlayerIdsForCompetition(competitionId);
  state.inflight = (async () => {
    try {
      await manager.syncCompetitionLeaderboardEquity(playerIds);
      for (const playerId of playerIds) {
        await syncCompetitionResultForPlayer(playerId, { persist: false });
      }
      void competitionManager.persist();
      state.lastAt = Date.now();
    } finally {
      state.inflight = null;
    }
  })();

  await state.inflight;
}

async function refreshCompetitionStoreIfServerless(): Promise<void> {
  if (IS_SERVERLESS) await competitionManager.refresh();
}

async function syncCompetitionResultForPlayer(
  playerId: string,
  options?: { persist?: boolean },
): Promise<void> {
  const player = manager.getPlayerById(playerId);
  if (!player) return;
  const update = competitionManager.updatePaperResultByPlayerId(player.id, {
    pnlUsd: player.pnl,
    pnlPercent: player.pnlPercent,
    tradesCount: player.tradeCount,
    equity: player.currentBalance,
  });
  if (update?.drawdownWarning) await sendDrawdownWarning(update);
  // Drawdown journalier atteint → on élimine le joueur : annulation des ordres,
  // clôture de toutes les positions (PnL figé) et déconnexion. Il ne pourra
  // plus trader (cf. assertCompetitionTraderCanTrade + canTrade côté client).
  if (update?.newlyBreached) {
    try {
      await manager.finalizeCompetitionPaperPlayer(player.id);
      const after = manager.getPlayerById(player.id);
      if (after) {
        competitionManager.updatePaperResultByPlayerId(after.id, {
          pnlUsd: after.pnl,
          pnlPercent: after.pnlPercent,
          tradesCount: after.tradeCount,
          equity: after.currentBalance,
        });
      }
    } catch (err) {
      console.error('[drawdown] breach finalize failed:', (err as Error)?.message);
    }
  }
  if (options?.persist === false) return;
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

    // Génère automatiquement les payouts des gagnants (prize table) pour toute
    // arène terminée dont les payouts n'ont pas encore été émis — y compris
    // celles finalisées avant l'introduction des payouts auto.
    const needPayouts = competitionManager.getCompetitionsNeedingPayouts();
    if (needPayouts.length > 0) {
      let total = 0;
      for (const competitionId of needPayouts) {
        const created = competitionManager.generateCompetitionPayouts(competitionId);
        total += created.length;
        for (const payout of created) notifyPayoutAvailable(payout);
      }
      await competitionManager.persist();
      if (total > 0) console.log(`[payouts] auto-generated ${total} payout(s) for ${needPayouts.length} ended arena(s)`);
    }
  })();

  try {
    await finalizingEndedCompetitions;
  } finally {
    finalizingEndedCompetitions = null;
    void syncLiveMarketFeeds();
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

async function assertCompetitionTraderCanTrade(token: string | null, playerId?: string): Promise<string | null> {
  const competitionId = await getCompetitionIdForTraderToken(token);
  if (!competitionId) return null;
  if (IS_SERVERLESS) await competitionManager.refresh();
  await finalizeEndedCompetitions();
  competitionManager.assertCompetitionTradingOpen(competitionId);
  // Élimination par drawdown journalier : aucun ordre/clôture/modif possible.
  if (playerId && competitionManager.isPaperPlayerBreached(competitionId, playerId)) {
    throw new Error('Compte éliminé : limite de drawdown journalier atteinte.');
  }
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
  const user = await competitionManager.getUserFromToken(token);
  if (!user) return null;
  return { ...user, country: countryFromPhone(user.phone) };
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
    const context = competitionManager.getCompetitionContextForPaperPlayer(competitionId, player.id);
    canTrade = status === 'live' && !context?.breached;
    competitionPayload = context || { id: competitionId };
  }

  return {
    player: publicPlayer(player),
    market: manager.getChartMarketSnapshot(),
    canTrade,
    competition: competitionPayload,
  };
}

function paperPositionSignature(player: NonNullable<ReturnType<typeof buildPaperUpdatePayload>>['player']): string {
  return JSON.stringify((player?.openPositions || []).map((position) => ({
    ...position,
    // Ces valeurs sont recalculées côté client à partir de market:tick.
    markPrice: undefined,
    pnl: undefined,
    unrealizedFunding: undefined,
  })));
}

function buildPaperPatch(
  previous: NonNullable<ReturnType<typeof buildPaperUpdatePayload>>,
  next: NonNullable<ReturnType<typeof buildPaperUpdatePayload>>,
) {
  const previousPlayer = previous.player;
  const nextPlayer = next.player;
  if (!previousPlayer || !nextPlayer) return next;

  const player: Record<string, unknown> = {};
  const scalarKeys = [
    'active',
    'initialBalance',
    'currentBalance',
    'availableMargin',
    'usedMargin',
    'feesPaid',
    'pnl',
    'pnlPercent',
    'pnlAdjustment',
    'realizedPnlArchived',
    'tradeCount',
    'rank',
    'previousRank',
    'winStreak',
    'longestPositionMinutes',
    'biggestTradePnl',
    'bestTradePercent',
    'lastUpdate',
    'connected',
  ] as const;
  for (const key of scalarKeys) {
    if (previousPlayer[key] !== nextPlayer[key]) player[key] = nextPlayer[key];
  }
  if (paperPositionSignature(previousPlayer) !== paperPositionSignature(nextPlayer)) {
    player.openPositions = nextPlayer.openPositions;
  }
  if (JSON.stringify(previousPlayer.openOrders) !== JSON.stringify(nextPlayer.openOrders)) {
    player.openOrders = nextPlayer.openOrders;
  }
  if (JSON.stringify(previousPlayer.badges) !== JSON.stringify(nextPlayer.badges)) {
    player.badges = nextPlayer.badges;
  }
  const previousTradeIds = new Set((previousPlayer.trades || []).map((trade) => trade.id));
  const nextTradeIds = new Set((nextPlayer.trades || []).map((trade) => trade.id));
  const addedTrades = (nextPlayer.trades || []).filter((trade) => !previousTradeIds.has(trade.id));
  const historyWasTrimmed = (previousPlayer.trades || []).some((trade) => !nextTradeIds.has(trade.id));
  // Un reset ou une troncature serveur doit rester réconciliable.
  if (historyWasTrimmed || (nextPlayer.trades || []).length < (previousPlayer.trades || []).length) {
    player.trades = nextPlayer.trades;
  } else if (addedTrades.length > 0) {
    player.tradesAdded = addedTrades;
  }

  const patch: Record<string, unknown> = {};
  if (Object.keys(player).length > 0) patch.player = player;
  if (previous.canTrade !== next.canTrade) patch.canTrade = next.canTrade;
  if (JSON.stringify(previous.competition) !== JSON.stringify(next.competition)) {
    patch.competition = next.competition;
  }
  return patch;
}

function snapshotPaperPayload(
  payload: NonNullable<ReturnType<typeof buildPaperUpdatePayload>>,
): NonNullable<ReturnType<typeof buildPaperUpdatePayload>> {
  return {
    ...payload,
    // Le marché voyage déjà dans market:tick ; inutile de le conserver pour
    // calculer le diff compte.
    market: {},
    player: payload.player
      ? {
          ...payload.player,
          openPositions: payload.player.openPositions.map((position) => ({ ...position })),
          openOrders: payload.player.openOrders.map((order) => ({ ...order })),
          trades: payload.player.trades.map((trade) => ({ ...trade })),
          badges: payload.player.badges.map((badge) => ({ ...badge })),
        }
      : null,
    competition: payload.competition
      ? JSON.parse(JSON.stringify(payload.competition))
      : payload.competition,
  };
}

function sendPaperUpdate(ws: WebSocket, sub: PaperClientSubscription): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    const payload = buildPaperUpdatePayload(sub.playerId, sub.competitionId);
    if (!payload) return;
    if (!sub.lastPayload) {
      // Garder le nom historique pour les apps déjà installées : elles
      // reçoivent le snapshot initial puis ignorent simplement paper:patch.
      sendWs(ws, JSON.stringify({ type: 'paper:update', data: payload }));
    } else {
      const patch = buildPaperPatch(sub.lastPayload, payload);
      if (Object.keys(patch).length > 0) {
        sendWs(ws, JSON.stringify({ type: 'paper:patch', data: patch }));
      }
    }
    sub.lastPayload = snapshotPaperPayload(payload);
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
  competition?: NonNullable<ReturnType<typeof competitionManager.getLiveLeaderboard>>['competition'];
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
  const competitionSignature = JSON.stringify(data.competition);
  const competitionChanged = arenaCompetitionSnapshots.get(competitionId) !== competitionSignature;
  arenaCompetitionSnapshots.set(competitionId, competitionSignature);
  if (upserts.length === 0 && removed.length === 0 && !competitionChanged) return null;
  return {
    competitionId,
    ...(competitionChanged ? { competition: data.competition } : {}),
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
      sendWs(ws, msg);
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
    sendWs(ws, JSON.stringify({ type: 'arena:init', data: init }));
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
      arenaCompetitionSnapshots.set(competitionId, JSON.stringify(init.competition));
    }
  }
}

function detachArenaClient(ws: WebSocket): void {
  for (const [competitionId, sockets] of arenaClients) {
    if (sockets.delete(ws) && sockets.size === 0) {
      arenaClients.delete(competitionId);
      arenaSnapshots.delete(competitionId);
      arenaCompetitionSnapshots.delete(competitionId);
    }
  }
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/ws', `http://${req.headers.host || 'localhost'}`);
  const paperToken = url.searchParams.get('paperToken');
  const publicArenaId = url.searchParams.get('arenaId');
  const arenaOnly = Boolean(publicArenaId && !paperToken);
  if (!arenaOnly) clients.add(ws);

  // Heartbeat : le socket est marqué vivant à la connexion, puis à chaque pong.
  // L'interval ci-dessous ping périodiquement et termine les sockets muets
  // (clients crashés, réseau coupé) qui resteraient sinon dans `clients`.
  (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
  ws.on('pong', () => {
    (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
  });

  // Send a full snapshot to the freshly connected client. Subsequent
  // updates arrive as small diffs (`state:patch`), which keeps a 500-trader
  // competition under a few KB per broadcast.
  if (!arenaOnly) {
    const initialState = manager.getStateInit();
    sendWs(ws, JSON.stringify({ type: 'state:init', data: initialState }));
  }

  if (publicArenaId) attachArenaClient(ws, publicArenaId);
  if (paperToken) {
    void competitionManager.getTraderSession(paperToken).then((info) => {
      if (!info || ws.readyState !== WebSocket.OPEN) return;
      const sub: PaperClientSubscription = {
        token: paperToken,
        playerId: info.playerId,
        competitionId: info.competitionId,
        lastPayload: null,
      };
      paperClients.set(ws, sub);
      sendPaperUpdate(ws, sub);
      if (info.competitionId && info.competitionId !== publicArenaId) attachArenaClient(ws, info.competitionId);
    }).catch(() => undefined);
  }

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg?.type === 'market:subscribe') applyMarketSubscribe(ws, msg.pairs);
    } catch {
      // ignore malformed client frames
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    paperClients.delete(ws);
    marketSubscriptions.delete(ws);
    detachArenaClient(ws);
  });
});

// Heartbeat global /ws : toutes les 30s, on termine les sockets qui n'ont pas
// répondu au ping précédent, puis on re-ping les autres. Évite l'accumulation
// de connexions « zombies » (compteur clients.size gonflé, fuite mémoire).
// Inutile en serverless (pas de process long-lived, pas de clients WS).
const WS_HEARTBEAT_MS = Number(process.env.WS_HEARTBEAT_MS) || 30_000;
if (!IS_SERVERLESS) {
  const heartbeatTimer = setInterval(() => {
    wss.clients.forEach((ws) => {
      const sock = ws as WebSocket & { isAlive?: boolean };
      if (sock.isAlive === false) {
        ws.terminate();
        return;
      }
      sock.isAlive = false;
      try {
        ws.ping();
      } catch {
        // noop : le close handler nettoiera les Sets/Maps
      }
    });
    chatWss.clients.forEach((ws) => {
      const sock = ws as WebSocket & { isAlive?: boolean };
      if (sock.isAlive === false) {
        ws.terminate();
        return;
      }
      sock.isAlive = false;
      try {
        ws.ping();
      } catch {
        // Le close handler nettoiera chatClients.
      }
    });
  }, WS_HEARTBEAT_MS);
  heartbeatTimer.unref?.();
}

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

// --- Suivi & configuration des emails (panneau admin « Emails ») ---------
app.get('/api/admin/emails/config', requireAdmin, async (_req, res) => {
  try {
    const settings = await getEmailSettings();
    res.json({ settings, catalog: EMAIL_CATALOG });
  } catch (err) {
    res.status(500).json({ error: (err as Error)?.message || 'Lecture impossible' });
  }
});

app.post('/api/admin/emails/config', requireAdmin, async (req, res) => {
  try {
    const body = (req.body || {}) as EmailSettingsPatch;
    const settings = await updateEmailSettings(body);
    res.json({ settings });
  } catch (err) {
    res.status(500).json({ error: (err as Error)?.message || 'Enregistrement impossible' });
  }
});

app.get('/api/admin/emails/log', requireAdmin, async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 100;
    const entries = await listEmailLog(limit);
    res.json({ entries });
  } catch (err) {
    res.status(500).json({ error: (err as Error)?.message || 'Lecture impossible' });
  }
});

// Envoi d'un email de test (données factices) pour prévisualiser un template.
app.post('/api/admin/emails/test', requireAdmin, async (req, res) => {
  const kind = String(req.body?.kind || '') as EmailKind;
  const to = String(req.body?.to || '').trim();
  if (!EMAIL_KINDS.includes(kind)) {
    res.status(400).json({ error: 'Type d\'email inconnu' });
    return;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    res.status(400).json({ error: 'Adresse email invalide' });
    return;
  }
  try {
    let result;
    if (kind === 'otp') {
      result = await sendOtpEmail(to, '123456', 'login');
    } else if (kind === 'prize_winner') {
      result = await sendPrizeWinnerEmail(to, {
        recipientName: 'Trader Test',
        competitionTitle: 'Arène de démonstration',
        rank: 1,
        rankLabel: '1ʳᵉ place',
        prizeLines: ['2 500 USDT', 'MacBook Pro'],
        totalParticipants: 128,
      });
    } else if (kind === 'new_arena') {
      result = await sendNewArenaEmail(to, {
        recipientName: 'Trader Test',
        title: 'Arène de démonstration',
        startLabel: 'lundi 16 juin 18:00',
        endLabel: 'vendredi 20 juin 18:00',
        durationLabel: '4 jours',
        prizeHeadline: '5 000 USDT',
        prizeBreakdown: ['1er · 2 500', '2e · 1 500', '3e · 1 000'],
        ctaUrl: (process.env.APP_PUBLIC_URL || 'https://btfarena.com').trim(),
      });
    } else {
      // arena_start_soon | rappels | podium | résultats → notification générique
      const headings: Record<string, string> = {
        arena_start_soon: "L'arène démarre bientôt",
        arena_register_reminder_24h: "L'arène démarre dans 24 heures",
        arena_no_trade_reminder: "L'arène a commencé il y a 2 jours",
        arena_podium_lost: 'On t’a pris ta place sur le podium !',
        arena_results: "Résultats — Arène de démonstration",
      };
      result = await sendNotificationEmail(
        to,
        `[Test] ${headings[kind] || 'Notification'}`,
        {
          eyebrow: 'Arène de démonstration',
          heading: headings[kind] || 'Notification',
          bodyLines: [
            'Salut Trader Test,',
            'Ceci est un email de test envoyé depuis le panneau admin pour prévisualiser le rendu.',
          ],
          highlight: '#1 / 128 · +12.4%',
          ctaLabel: 'Voir la plateforme',
          ctaUrl: (process.env.APP_PUBLIC_URL || 'https://btfarena.com').trim(),
        },
        kind,
      );
    }
    res.json({ ok: Boolean(result?.delivered), result });
  } catch (err) {
    res.status(500).json({ error: (err as Error)?.message || 'Envoi impossible' });
  }
});

// --- Réparation ONE-SHOT : fermetures fantômes du 2026-06-01 ~22:19 UTC ---
// Un feed marché vide/glitché a fermé de force des positions à prix aberrant,
// gonflant/cassant le PnL de quelques joueurs. Cet endpoint supprime ces
// fermetures et restaure les positions concernées, en mémoire + en base, pour
// les seuls playerIds fournis. Idempotent.
app.post('/api/admin/competition/repair-glitch', requireAdmin, async (req, res) => {
  const playerIds: string[] = Array.isArray(req.body?.playerIds)
    ? req.body.playerIds.map((v: unknown) => String(v))
    : [];
  if (playerIds.length === 0) {
    res.status(400).json({ error: 'playerIds (array) requis' });
    return;
  }
  const fromMs = Number(req.body?.fromMs) || Date.parse('2026-06-01T22:19:00Z');
  const toMs = Number(req.body?.toMs) || Date.parse('2026-06-01T22:23:00Z');
  try {
    const report = await manager.repairGlitchCloses(playerIds, fromMs, toMs);
    for (const entry of report) {
      if (entry.status === 'repaired') {
        await syncCompetitionResultForPlayer(String(entry.id));
      }
    }
    res.json({ ok: true, fromMs, toMs, report });
  } catch (err: any) {
    console.error('[repair-glitch] error', err);
    res.status(500).json({ error: err?.message || 'repair failed' });
  }
});

app.post('/api/admin/competition/normalize-restored-positions', requireAdmin, async (req, res) => {
  const playerIds: string[] = Array.isArray(req.body?.playerIds)
    ? req.body.playerIds.map((v: unknown) => String(v))
    : [];
  if (playerIds.length === 0) {
    res.status(400).json({ error: 'playerIds (array) requis' });
    return;
  }
  try {
    const report = await manager.normalizeRestoredCompetitionPositionIds(playerIds);
    res.json({ ok: true, report });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'normalize failed' });
  }
});

app.post('/api/admin/competition/restore-position-risk', requireAdmin, async (req, res) => {
  const overrides = Array.isArray(req.body?.overrides) ? req.body.overrides : [];
  if (overrides.length === 0) {
    res.status(400).json({ error: 'overrides (array) requis' });
    return;
  }
  try {
    const report = await manager.applyCompetitionPositionRiskOverrides(overrides);
    for (const entry of report) {
      if (entry.status === 'updated') {
        await syncCompetitionResultForPlayer(String(entry.playerId));
      }
    }
    res.json({ ok: true, report });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'restore risk failed' });
  }
});

// Fermeture admin à prix fixe — un seul joueur par appel (ex. compensation TP chakal).
app.post('/api/admin/competition/pnl-compensation', requireAdmin, async (req, res) => {
  const playerId = String(req.body?.playerId || '').trim();
  const amountUsd = Number(req.body?.amountUsd);
  const note = req.body?.note ? String(req.body.note) : undefined;
  const mode = req.body?.mode === 'set' ? 'set' : 'increment';
  if (!playerId) {
    res.status(400).json({ error: 'playerId requis' });
    return;
  }
  if (!Number.isFinite(amountUsd)) {
    res.status(400).json({ error: 'amountUsd invalide' });
    return;
  }
  try {
    const report = await manager.applyCompetitionPnlCompensation(playerId, amountUsd, note, mode);
    if (report.status === 'credited') {
      await syncCompetitionResultForPlayer(playerId);
    }
    res.json({ ok: true, report });
  } catch (err: any) {
    console.error('[pnl-compensation] error', err);
    res.status(500).json({ error: err?.message || 'compensation failed' });
  }
});

app.post('/api/admin/competition/restore-player-snapshot', requireAdmin, async (req, res) => {
  const playerId = String(req.body?.playerId || '').trim();
  const snapshot = req.body?.snapshot;
  if (!playerId || !snapshot || typeof snapshot !== 'object') {
    res.status(400).json({ error: 'playerId et snapshot (objet StoredPlayer) requis' });
    return;
  }
  try {
    const report = await manager.forceRestoreCompetitionPlayerSnapshot(playerId, snapshot);
    if (report.status === 'restored') {
      await syncCompetitionResultForPlayer(playerId);
    }
    res.json({ ok: true, report });
  } catch (err: any) {
    console.error('[restore-player-snapshot] error', err);
    res.status(500).json({ error: err?.message || 'restore failed' });
  }
});

app.post('/api/admin/competition/close-positions-at-price', requireAdmin, async (req, res) => {
  const playerId = String(req.body?.playerId || '').trim();
  const exitPrice = Number(req.body?.exitPrice);
  if (!playerId) {
    res.status(400).json({ error: 'playerId requis' });
    return;
  }
  if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
    res.status(400).json({ error: 'exitPrice invalide' });
    return;
  }
  const reason = req.body?.reason;
  const allowedReasons = new Set(['manual', 'stop-loss', 'take-profit', 'liquidation']);
  const closeReason = allowedReasons.has(reason) ? reason : 'take-profit';
  const positionIds = Array.isArray(req.body?.positionIds)
    ? req.body.positionIds.map((v: unknown) => String(v))
    : undefined;
  const pair = req.body?.pair ? String(req.body.pair) : undefined;
  const side = req.body?.side === 'long' || req.body?.side === 'short' ? req.body.side : undefined;

  try {
    const report = await manager.closeCompetitionPositionsAtPrice({
      playerId,
      exitPrice,
      reason: closeReason,
      positionIds,
      pair,
      side,
    });
    const entry = report[0];
    if (entry && (entry.status === 'closed' || entry.status === 'partial')) {
      await syncCompetitionResultForPlayer(playerId);
    }
    res.json({ ok: true, report });
  } catch (err: any) {
    console.error('[close-positions-at-price] error', err);
    res.status(500).json({ error: err?.message || 'close failed' });
  }
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

app.patch('/api/roster/:id/color', requireAdmin, (req, res) => {
  const color = typeof req.body?.color === 'string' ? req.body.color : '';
  if (!color) {
    res.status(400).json({ error: 'color required' });
    return;
  }
  const player = manager.setPlayerColor(req.params.id, color);
  if (!player) {
    res.status(400).json({ error: 'Joueur introuvable ou couleur invalide (#RRGGBB attendu)' });
    return;
  }
  const { apiKey: _k, apiSecret: _s, ...publicPlayer } = player;
  res.json(publicPlayer);
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
    await syncLiveMarketFeeds();
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Impossible de lancer l’événement' });
    return;
  }
  res.json({ ok: true, startTime: manager.getEventStartTime(), endTime: manager.getEventEndTime() });
});

app.post('/api/event/stop', requireAdmin, async (_req, res) => {
  await manager.stopEvent();
  void syncLiveMarketFeeds();
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

// --- Malus (roue de la fortune, déclenché par l'admin) ---

app.post('/api/event/malus', requireAdmin, (req, res) => {
  const forced = req.body?.type === 'direction' || req.body?.type === 'asset' ? req.body.type : undefined;
  const malus = manager.triggerMalus(forced);
  if (!malus) {
    res.status(409).json({ error: 'Aucun événement en cours' });
    return;
  }
  res.json({ ok: true, malus });
});

app.delete('/api/event/malus', requireAdmin, (_req, res) => {
  manager.clearMalus();
  res.json({ ok: true });
});

// --- Paper trading meta & auth ---

app.get('/api/paper/meta', async (_req, res) => {
  const pairs = manager.getSupportedPaperPairs();
  // Sur Railway le feed iTick/Binance tient le snapshot à jour en RAM ;
  // refreshTickers() sur chaque hit ajoutait des appels upstream inutiles.
  const market = IS_SERVERLESS
    ? await manager.refreshPaperMarketSnapshot()
    : manager.getChartMarketSnapshot();
  res.json({
    enabled: manager.getPlatformMode() === 'paper',
    eventStarted: manager.isStarted(),
    eventEndTime: manager.getEventEndTime(),
    eventDurationMinutes: manager.getEventDurationMinutes(),
    startingBalance: manager.getPaperStartingBalance(),
    pairs,
    market,
    marketMetadata: await getMarketMetadata(pairs),
    fees: manager.getPaperFeeRates(),
    marketDataSource: manager.getMarketDataSource(),
  });
});

app.get('/api/paper/candles', async (req, res) => {
  const pair = String(req.query.pair || 'BTC/USD');
  const interval = Number(req.query.interval || 1);
  if (!isLiveMarketNeeded()) {
    res.set('Cache-Control', 'public, max-age=15');
    res.json({ pair, interval, candles: [], source: 'idle' });
    return;
  }
  const from = Number(req.query.from);
  const to = Number(req.query.to);
  const countBack = parseCandleLimit(req.query.countBack, MAX_PUBLIC_CANDLES);
  const candleOpts = {
    from: Number.isFinite(from) && from > 0 ? from : undefined,
    to: Number.isFinite(to) && to > 0 ? to : undefined,
    countBack,
  };

  try {
    const pairDef = getPaperPairDefinition(pair);
    let candles;
    let source: 'itick' | 'hyperliquid' | 'binance' | 'kraken' = 'kraken';

    // Pair iTick (forex / commodity / index) → store local Postgres.
    // Si vide, backfill REST iTick (avec fallback Hyperliquid xyz si dispo).
    if (isItickPair(pair)) {
      // getCandles backfill lazy (scroll gauche) via ensureScrollHistory.
      let itickBars = await itickCandles.getCandles(pair, interval, candleOpts);
        if (itickBars.length === 0 && isLiveMarketNeeded()) {
        const nowSec = Math.floor(Date.now() / 1000);
        const targetTo = candleOpts.to ?? nowSec;
        const targetFrom = candleOpts.from ?? targetTo - interval * 60 * (candleOpts.countBack ?? 500);
        try {
          await itickCandles.backfillRange(pair, interval, targetFrom, targetTo);
        } catch (err) {
          console.warn(`[candles] backfill iTick ${pair} ${interval}m KO:`, (err as Error).message);
        }
        itickBars = await itickCandles.getCandles(pair, interval, candleOpts);
      }
      if (itickBars.length > 0) {
        candles = itickBars;
        source = 'itick';
      } else if (isLiveMarketNeeded()) {
        // Dernier recours : Hyperliquid direct si on a un coin xyz pour
        // cette pair. Évite une 400 si iTick est complètement injoignable.
        try {
          candles = await hyperliquid.getOhlcCandles(pair, interval, candleOpts);
          source = 'hyperliquid';
        } catch {
          candles = [];
        }
      } else {
        candles = [];
      }
    } else if (pairDef?.source === 'kraken_futures' || pairToBinanceSymbol(pair)) {
      // Crypto : store Postgres persistant (cryptoCandlesStore) avec backfill
      // à la demande au scroll. L'historique survit aux redémarrages et les
      // scrolls suivants sont servis depuis la DB sans retaper l'upstream.
      // Comme le datafeed web n'envoie pas `from` au premier rendu, on sert
      // immédiatement son cache rapide. Le scroll historique (avec `from`)
      // continue d'utiliser le store Postgres profond.
      candles = candleOpts.from == null
        ? await engineCandlesCache.getCachedCandles(pair, interval, 'binance', candleOpts)
        : await cryptoCandlesStore.getCandles(pair, interval, candleOpts);
      source = 'binance';
      if (candles.length === 0) {
        // Repli : si le store n'a encore rien (ex. backfill upstream KO),
        // on retombe sur le cache RAM historique pour ne pas vider le chart.
        candles = await engineCandlesCache.getCachedCandles(pair, interval, 'binance', candleOpts);
      }
    } else if (manager.getMarketDataSource() === 'binance') {
      candles = await engineCandlesCache.getCachedCandles(pair, interval, 'binance', candleOpts);
      source = 'binance';
    } else {
      try {
        candles = await engineCandlesCache.getCachedCandles(pair, interval, 'kraken', candleOpts);
      } catch (err) {
        console.warn(`[candles] cache miss ${pair}, direct Kraken:`, (err as Error).message);
        candles = isLiveMarketNeeded() ? await kraken.getOhlcCandles(pair, interval) : [];
      }
      source = 'kraken';
    }
    if (candleOpts.from == null) {
      // Le snapshot initial est partagé et brièvement réutilisable. Les ticks
      // WebSocket prennent ensuite le relais pour la bougie en cours.
      res.set('Cache-Control', 'public, max-age=5, s-maxage=5, stale-while-revalidate=20');
    } else {
      // Les pages historiques sont composées de bougies déjà closes : un CDN
      // peut les servir longtemps sans toucher Railway.
      res.set('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600');
    }
    if (Array.isArray(candles) && candles.length > MAX_PUBLIC_CANDLES) {
      candles = candles.slice(-MAX_PUBLIC_CANDLES);
    }
    res.json({ pair, interval, candles, source });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Historique indisponible' });
  }
});

/**
 * POST /api/admin/replay/candles — bougies 1m multi-paires pour le mode
 * Replay (rejouer une partie live passée). Body: { pairs, fromMs, toMs }.
 * Sert la fenêtre demandée depuis les stores persistants (itick/crypto),
 * avec backfill REST à la demande si la DB ne couvre pas encore la période.
 */
app.post('/api/admin/replay/candles', requireAdmin, async (req, res) => {
  const pairs = Array.isArray(req.body?.pairs)
    ? [...new Set((req.body.pairs as unknown[]).map((p) => String(p || '').trim().toUpperCase()).filter(Boolean))]
    : [];
  const fromMs = Number(req.body?.fromMs);
  const toMs = Number(req.body?.toMs);
  if (pairs.length === 0 || pairs.length > 16) {
    res.status(400).json({ error: 'pairs requis (1 à 16 paires)' });
    return;
  }
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    res.status(400).json({ error: 'Fenêtre fromMs/toMs invalide' });
    return;
  }
  if (toMs - fromMs > 24 * 60 * 60 * 1000) {
    res.status(400).json({ error: 'Fenêtre limitée à 24h' });
    return;
  }

  // Marge d'une bougie de chaque côté pour interpoler proprement aux bords.
  const fromSec = Math.floor(fromMs / 1000) - 120;
  const toSec = Math.ceil(toMs / 1000) + 120;
  const countBack = Math.ceil((toSec - fromSec) / 60) + 10;
  const candleOpts = { from: fromSec, to: toSec, countBack };

  const out: Record<string, OhlcCandle[]> = {};
  const errors: Record<string, string> = {};
  for (const pair of pairs) {
    try {
      let bars: OhlcCandle[] = [];
      if (isItickPair(pair)) {
        bars = await itickCandles.getCandles(pair, 1, candleOpts);
        // Couverture incomplète (partie ancienne pas encore en DB) → backfill REST.
        if (bars.length < Math.max(1, Math.floor((toSec - fromSec) / 60) - 30)) {
          try {
            await itickCandles.backfillRange(pair, 1, fromSec, toSec);
          } catch (err) {
            console.warn(`[replay] backfill iTick ${pair} KO:`, (err as Error).message);
          }
          bars = await itickCandles.getCandles(pair, 1, candleOpts);
        }
        if (bars.length === 0) {
          // Dernier recours : REST iTick direct (paginé), sans passer par la DB.
          const inst = findItickByPair(pair);
          if (inst) {
            bars = await itick.getKline(inst.code, 1, Math.min(500, countBack), toSec * 1000, inst.asset);
            bars = bars.filter((bar) => bar.time >= fromSec && bar.time <= toSec);
          }
        }
      } else if (pairToBinanceSymbol(pair)) {
        bars = await cryptoCandlesStore.getCandles(pair, 1, candleOpts);
        if (bars.length === 0) {
          const result = await cryptoCandles.getCryptoOhlc(pair, 1, { to: toSec, countBack });
          bars = result.candles.filter((bar) => bar.time >= fromSec && bar.time <= toSec);
        }
      }
      if (bars.length === 0) {
        errors[pair] = 'Aucune bougie disponible sur la fenêtre';
      } else {
        out[pair] = bars;
      }
    } catch (err) {
      errors[pair] = (err as Error).message || 'Erreur historique';
    }
  }

  res.json({ candles: out, errors });
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
  const breached = competitionId ? competitionManager.isPaperPlayerBreached(competitionId, player.id) : false;
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
    canTrade: isCompetition ? (competitionStatus === 'live' && !breached) : manager.canTradeLiveEvent(),
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
    const competitionId = await assertCompetitionTraderCanTrade(token, player.id);
    const handler = competitionId
      ? manager.placeCompetitionPaperOrder.bind(manager)
      : manager.placePaperOrder.bind(manager);
    const result = await handler(player.id, {
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
    res.json({ ok: true, trade: result.trade });
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
    const competitionId = await assertCompetitionTraderCanTrade(token, player.id);
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
    const competitionId = await assertCompetitionTraderCanTrade(token, player.id);
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
    const competitionId = await assertCompetitionTraderCanTrade(token, player.id);
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
      res.json({ ok: true, alreadyClosed: result.alreadyClosed, trade: result.trade });
    } else {
      const result = await manager.closePaperPosition(player.id, positionRef, partialSize);
      res.json({ ok: true, trade: result.trade });
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
    const competitionId = await assertCompetitionTraderCanTrade(token, player.id);
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
    await refreshCompetitionStoreIfServerless();
    const result = await competitionManager.loginTestAccount(String(username || ''));
    let testCompetitionId: string | null = null;
    if (MOBILE_STAGING_TEST_MODE) {
      const title = 'STAGING — PNL RACE LIVE TEST';
      let competition = competitionManager
        .listAdminCompetitions()
        .find((item) => item.title === title && item.status === 'live');
      if (!competition) {
        const now = Date.now();
        competition = {
          ...competitionManager.createCompetition({
            title,
            code: '',
            executionMode: 'paper',
            startAt: now - 5 * 60_000,
            endAt: now + 30 * 24 * 60 * 60_000,
            registrationEndsAt: now - 5 * 60_000,
            dailyDrawdownPercent: 10,
            isPublic: true,
          }),
          status: 'live',
          participants: 0,
          entriesDetailed: [],
        };
      }
      testCompetitionId = competition.id;
      // Cette arène ne doit jamais produire de notifications externes.
      competitionManager.markCompetitionNotified(competition.id, 'newArena');
      competitionManager.markCompetitionNotified(competition.id, 'newArenaPush');
      competitionManager.markCompetitionNotified(competition.id, 'startSoon');
      competitionManager.markCompetitionNotified(competition.id, 'registerReminder24h');
      competitionManager.markCompetitionNotified(competition.id, 'noTradeReminder');
      competitionManager.markCompetitionNotified(competition.id, 'ended');
      try {
        competitionManager.joinCompetition(result.user.id, '', undefined, competition.id, true);
      } catch (joinError: any) {
        if (!String(joinError?.message || '').toLowerCase().includes('deja inscrit')) throw joinError;
      }
      await competitionManager.persist();
      await startStagingSimulation();
      void syncLiveMarketFeeds();
    }
    res.json({ ...result, testCompetitionId });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Connexion test impossible' });
  }
});

app.post('/api/competition/auth/request', rateLimit({ windowMs: 10 * 60 * 1000, max: 8, key: 'auth-request' }), async (req, res) => {
  const { email, name, intent, phone, consent } = req.body || {};
  const safeIntent = intent === 'signup' ? 'signup' : intent === 'login' ? 'login' : null;
  if (!safeIntent) {
    res.status(400).json({ error: 'intent invalide (signup ou login)' });
    return;
  }
  try {
    // Serverless only: merge signups from sibling Lambdas before duplicate checks.
    await refreshCompetitionStoreIfServerless();
    const { code, expiresAt } = await competitionManager.requestOtp({
      email: String(email || ''),
      name: name == null ? undefined : String(name),
      phone: phone == null ? undefined : String(phone),
      intent: safeIntent,
      consent: Boolean(consent),
    });

    const result = competitionManager.isAppleReviewEmail(String(email || ''))
      ? { delivered: true as const, error: undefined }
      : await sendOtpEmail(String(email || '').trim(), code, safeIntent);

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
    await refreshCompetitionStoreIfServerless();
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
    await refreshCompetitionStoreIfServerless();
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

app.post('/api/competition/me/push-device', async (req, res) => {
  const user = await getCompetitionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Session requise' });
    return;
  }
  try {
    await registerPushDevice(user.id, req.body?.token, req.body?.platform, req.body?.environment);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message || 'Token push invalide' });
  }
});

app.delete('/api/competition/me/push-device', async (req, res) => {
  const user = await getCompetitionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Session requise' });
    return;
  }
  await unregisterPushDevice(user.id, req.body?.token);
  res.json({ ok: true });
});

app.post('/api/competition/me/push-test', async (req, res) => {
  const user = await getCompetitionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Session requise' });
    return;
  }
  const status = await describePushForUser(user.id);
  console.log(`[push] test requested by ${user.id} devices=${status.devices} configured=${status.configured}`);
  const sent = await sendPushToUser(user.id, {
    title: 'Test BTF Arena',
    body: 'Si tu vois ça, les notifications marchent.',
    kind: 'news',
  });
  res.json({
    ok: true,
    sent,
    configured: status.configured || isPushConfigured(),
    devices: status.devices,
  });
});

app.get('/api/competition/chat/messages', rateLimit({ windowMs: 60_000, max: 120, key: 'global-chat-read' }), async (req, res) => {
  const room = String(req.query.competitionId || '').trim() || null;
  const viewer = await getCompetitionUser(req);
  // Lecture ouverte pour les salles d'arène (spectateurs non connectés).
  // Le chat global reste authentifié.
  if (!room && !viewer) {
    res.status(401).json({ error: 'Connexion requise' });
    return;
  }
  const beforeValue = Number(String(req.query.before || ''));
  const messages = await listGlobalChatMessages({
    before: Number.isFinite(beforeValue) && beforeValue > 0 ? beforeValue : undefined,
    limit: 80,
    competitionId: room,
    viewerUserId: viewer?.id,
  });
  res.json({ messages });
});

app.post('/api/competition/chat/messages', rateLimit({ windowMs: 60_000, max: 20, key: 'global-chat-send' }), async (req, res) => {
  const user = await getCompetitionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Connexion requise' });
    return;
  }
  const room = String(req.body?.competitionId || '').trim() || null;
  try {
    const message = await createGlobalChatMessage(user, {
      body: req.body?.body,
      replyToId: req.body?.replyToId,
      imageUrl: req.body?.imageUrl,
      competitionId: room,
    });
    broadcastGlobalChatMessage(message);
    notifyGlobalChatReply(user, message);
    res.status(201).json({ message });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message || 'Message invalide' });
  }
});

app.get('/api/competition/chat/blocks', rateLimit({ windowMs: 60_000, max: 60, key: 'global-chat-blocks-read' }), async (req, res) => {
  const user = await getCompetitionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Connexion requise' });
    return;
  }
  const blockedUserIds = await listBlockedChatUserIds(user.id);
  res.json({ blockedUserIds });
});

app.post('/api/competition/chat/users/:userId/block', rateLimit({ windowMs: 60_000, max: 20, key: 'global-chat-block' }), async (req, res) => {
  const user = await getCompetitionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Connexion requise' });
    return;
  }
  try {
    await blockChatUser(user.id, String(req.params.userId || '').trim());
    res.status(201).json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message || 'Blocage impossible' });
  }
});

app.delete('/api/competition/chat/users/:userId/block', rateLimit({ windowMs: 60_000, max: 20, key: 'global-chat-unblock' }), async (req, res) => {
  const user = await getCompetitionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Connexion requise' });
    return;
  }
  await unblockChatUser(user.id, String(req.params.userId || '').trim());
  res.json({ ok: true });
});

app.post('/api/competition/chat/messages/:messageId/report', rateLimit({ windowMs: 60_000, max: 10, key: 'global-chat-report' }), async (req, res) => {
  const user = await getCompetitionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Connexion requise' });
    return;
  }
  try {
    const created = await reportGlobalChatMessage({
      reporterUserId: user.id,
      messageId: String(req.params.messageId || '').trim(),
      reason: String(req.body?.reason || '') as ChatReportReason,
      details: req.body?.details,
    });
    if (created) {
      const messageId = String(req.params.messageId || '').trim();
      const reason = String(req.body?.reason || '').trim();
      void sendNotificationEmail(
        MODERATION_CONTACT_EMAIL,
        `[Modération] Nouveau signalement chat — ${reason}`,
        {
          eyebrow: 'SÉCURITÉ DU CHAT',
          heading: 'Un message a été signalé',
          bodyLines: [
            `Signalé par ${user.name} (${user.email}).`,
            `Message : ${messageId}`,
            `Motif : ${reason}`,
            'Le signalement est enregistré avec le statut pending dans comp_chat_reports.',
          ],
          highlight: 'À examiner rapidement',
        },
      ).catch((error) => {
        console.warn('[chat moderation] notification email failed:', error?.message || error);
      });
    }
    res.status(created ? 201 : 200).json({ ok: true, duplicate: !created });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message || 'Signalement impossible' });
  }
});

app.post('/api/competition/chat/images', rateLimit({ windowMs: 60_000, max: 10, key: 'global-chat-upload' }), upload.single('image'), async (req, res) => {
  const user = await getCompetitionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Connexion requise' });
    return;
  }
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
    if (!buffer?.length) {
      res.status(400).json({ error: 'Fichier image illisible' });
      return;
    }
    const optimized = await optimizeUploadedImage(buffer, { maxSide: 1600, quality: 82 });
    const imageUrl = await putChatImage(user.id, optimized.mime, optimized.buffer);
    invalidateBlobCache(`chat:${imageUrl.slice(imageUrl.lastIndexOf('/') + 1)}`);
    res.status(201).json({ imageUrl });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message || 'Upload impossible' });
  }
});

app.get('/api/chat-images/:id', async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    res.status(404).json({ error: 'Image introuvable' });
    return;
  }
  try {
    await sendImageBlob(res, `chat:${id}`, () => getChatImage(id), String(req.query.w || ''));
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Lecture impossible' });
  }
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

app.delete('/api/competition/me', async (req, res) => {
  const user = await getCompetitionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Session invalide' });
    return;
  }
  try {
    const { paperPlayerIds } = await competitionManager.deleteUserAccount(user.id);
    for (const playerId of paperPlayerIds) {
      try {
        await manager.finalizeCompetitionPaperPlayer(playerId);
      } catch (error) {
        console.warn('[account] finalize paper player failed:', (error as Error).message);
      }
      manager.removePlayer(playerId);
    }
    await Promise.all([
      unregisterAllPushDevices(user.id),
      deleteUserRating(user.id),
      anonymizeChatForUser(user.id),
    ]);
    invalidateBlobCache(`avatar:${user.id}`);
    if (IS_SERVERLESS) await competitionManager.persist();
    res.json({ ok: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Suppression du compte impossible' });
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
  const version = String(req.query.v || '').replace(/[^0-9]/g, '').slice(0, 20);
  try {
    await sendImageBlob(
      res,
      `avatar:${userId}${version ? `:v${version}` : ''}`,
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
    // Détourage auto du fond blanc (visuels de lots souvent exportés avec un
    // fond blanc plutôt que transparent). N'affecte que les images dont les
    // bords sont blancs ; sinon l'image est conservée telle quelle.
    const optimized = await transparentizeWhiteBackground(buffer, { maxSide: 960 });
    const id = crypto.randomUUID();
    await competitionManager.putPrizeImage(id, optimized.mime, optimized.buffer);
    invalidateBlobCache(`prize:${id}`);
    res.json({ imageUrl: `/api/prize-images/${id}?v=${Date.now()}` });
  } catch (error: any) {
    console.error('[prize-image] upload failed:', error?.message);
    res.status(500).json({ error: error.message || 'Upload impossible' });
  }
});

// Upload d'un logo/visuel de promotion. Contrairement aux lots, on NE détoure
// PAS le blanc (les logos sont déjà détourés / souvent blancs sur transparent)
// et on préserve la transparence (WebP avec alpha). Servi via /api/prize-images/:id.
app.post('/api/admin/promotion-image', requireAdmin, upload.single('image'), async (req, res) => {
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
    const optimized = await optimizeUploadedImage(buffer, { maxSide: 512, quality: 86 });
    const id = crypto.randomUUID();
    await competitionManager.putPrizeImage(id, optimized.mime, optimized.buffer);
    invalidateBlobCache(`prize:${id}`);
    res.json({ imageUrl: `/api/prize-images/${id}?v=${Date.now()}` });
  } catch (error: any) {
    console.error('[promotion-image] upload failed:', error?.message);
    res.status(500).json({ error: error.message || 'Upload impossible' });
  }
});

app.post('/api/admin/news-cover', requireAdmin, upload.single('image'), async (req, res) => {
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
    if (!buffer?.length) {
      res.status(400).json({ error: 'Fichier image illisible' });
      return;
    }
    const optimized = await optimizeUploadedImage(buffer, { maxSide: 1600, quality: 84 });
    const id = crypto.randomUUID();
    await competitionManager.putPrizeImage(id, optimized.mime, optimized.buffer);
    invalidateBlobCache(`prize:${id}`);
    res.json({ imageUrl: `/api/prize-images/${id}?v=${Date.now()}` });
  } catch (error: any) {
    console.error('[news-cover] upload failed:', error?.message);
    res.status(500).json({ error: error.message || 'Upload impossible' });
  }
});

// Bannière d'arène (visuel paysage mis en avant sur le leaderboard, ex. "CUP").
// On NE détoure PAS le blanc (c'est une photo, pas un logo) et on garde un
// grand côté pour un rendu net en pleine largeur. Stockée dans la même table
// que les lots, servie via /api/prize-images/:id.
app.post('/api/admin/arena-banner', requireAdmin, upload.single('image'), async (req, res) => {
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
    const optimized = await optimizeUploadedImage(buffer, { maxSide: 1600, quality: 82 });
    const id = crypto.randomUUID();
    await competitionManager.putPrizeImage(id, optimized.mime, optimized.buffer);
    invalidateBlobCache(`prize:${id}`);
    res.json({ imageUrl: `/api/prize-images/${id}?v=${Date.now()}` });
  } catch (error: any) {
    console.error('[arena-banner] upload failed:', error?.message);
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

/* -------------------------------- ACTUALITÉS -------------------------------- */

app.get('/api/news', async (req, res) => {
  try {
    const beforeValue = Number(req.query.before);
    const limitValue = Number(req.query.limit);
    const news = await newsStore.listPublicNews(
      Number.isFinite(beforeValue) && beforeValue > 0 ? beforeValue : Date.now() + 1,
      Number.isFinite(limitValue) ? limitValue : 20,
    );
    res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');
    res.json({ news });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Lecture des actualités impossible' });
  }
});

app.get('/api/news/:id', async (req, res) => {
  const article = await newsStore.getNews(String(req.params.id || ''));
  if (!article) {
    res.status(404).json({ error: 'Actualité introuvable' });
    return;
  }
  res.json({ article });
});

app.get('/api/admin/news', requireAdmin, async (_req, res) => {
  try {
    res.json({ news: await newsStore.listAdminNews() });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Lecture des actualités impossible' });
  }
});

async function notifyPublishedNews(
  article: Awaited<ReturnType<typeof newsStore.createNews>>,
): Promise<{ article: Awaited<ReturnType<typeof newsStore.createNews>>; notified: number }> {
  if (!shouldSendNewsPush(article)) return { article, notified: 0 };
  const notified = await sendPushToAllDevices({
    title: article.title,
    body: article.summary || article.body.slice(0, 140),
    kind: 'news',
    data: { newsId: article.id },
  });
  return { article: await newsStore.markPushSent(article.id), notified };
}

app.post('/api/admin/news', requireAdmin, async (req, res) => {
  try {
    const created = await newsStore.createNews(req.body || {});
    const { article, notified } = await notifyPublishedNews(created);
    res.status(201).json({ article, notified });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Création impossible' });
  }
});

app.patch('/api/admin/news/:id', requireAdmin, async (req, res) => {
  try {
    const updated = await newsStore.updateNews(String(req.params.id || ''), req.body || {});
    const { article, notified } = await notifyPublishedNews(updated);
    res.json({ article, notified });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Mise à jour impossible' });
  }
});

app.post('/api/admin/news/:id/publish', requireAdmin, async (req, res) => {
  try {
    const published = await newsStore.updateNews(String(req.params.id || ''), { published: true });
    // Une publication est un événement public : le push part exactement une
    // fois, indépendamment de l'ancien checkbox admin.
    const { article, notified } = await notifyPublishedNews(published);
    res.json({ article, notified });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Publication impossible' });
  }
});

app.delete('/api/admin/news/:id', requireAdmin, async (req, res) => {
  try {
    await newsStore.deleteNews(String(req.params.id || ''));
    res.json({ ok: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Suppression impossible' });
  }
});

/* ----------------------- PROMOTIONS / TRADE LIVE BONUS ----------------------- */

// Liste publique des deals partenaires (page /compete/bonus).
app.get('/api/promotions', async (req, res) => {
  try {
    const lang = String(req.query.lang || '').toLowerCase() === 'en' ? 'en' : 'fr';
    const promotions = await promotionsStore.listPublicPromotions(lang);
    res.json({ promotions });
  } catch (error: any) {
    console.error('[promotions] list public failed:', error?.message);
    res.status(500).json({ error: error.message || 'Lecture des promotions impossible' });
  }
});

app.get('/api/admin/promotions', requireAdmin, async (_req, res) => {
  try {
    const promotions = await promotionsStore.listPromotions();
    res.json({ promotions });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Lecture des promotions impossible' });
  }
});

app.post('/api/admin/promotions', requireAdmin, async (req, res) => {
  try {
    const promotion = await promotionsStore.createPromotion(req.body || {});
    res.json({ ok: true, promotion });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Création de la promotion impossible' });
  }
});

app.patch('/api/admin/promotions/:id', requireAdmin, async (req, res) => {
  try {
    const promotion = await promotionsStore.updatePromotion(String(req.params.id || ''), req.body || {});
    res.json({ ok: true, promotion });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Mise à jour de la promotion impossible' });
  }
});

app.delete('/api/admin/promotions/:id', requireAdmin, async (req, res) => {
  try {
    await promotionsStore.deletePromotion(String(req.params.id || ''));
    res.json({ ok: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Suppression de la promotion impossible' });
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

// --- Notifications email des arènes (départ imminent, podium perdu, fin) ---
// Boucle background : inutile en serverless (pas de process long-lived sur
// Netlify) ; en prod Railway / dev local elle tourne toutes les 60s. On
// finalise d'abord les arènes terminées pour que les emails de résultats
// partent avec des classements définitifs.
const competitionNotifier = new CompetitionNotifier(competitionManager);
const competitionPushNotifier = new CompetitionPushNotifier(competitionManager);
if (!IS_SERVERLESS) {
  const notifierTimer = setInterval(() => {
    void (async () => {
      await maybeFinalizeEndedCompetitions();
      await competitionNotifier.tick();
    })().catch((error) => {
      console.error('[notifier] loop error:', (error as Error)?.message);
    });
  }, 60_000);
  if (typeof notifierTimer.unref === 'function') notifierTimer.unref();

  const pushNotifierTimer = setInterval(() => {
    void competitionPushNotifier.tick().catch((error) => {
      console.error('[push notifier] loop error:', (error as Error)?.message);
    });
  }, 15_000);
  if (typeof pushNotifierTimer.unref === 'function') pushNotifierTimer.unref();
  setTimeout(() => void competitionPushNotifier.tick().catch(() => undefined), 2_000).unref?.();
}

// Envoi MANUEL de l'annonce « nouvelle arène » à tous les utilisateurs non
// inscrits. Fiable (synchrone, sans dépendre du minuteur). Respecte le réglage
// du panneau Emails (type new_arena en mode `off` → refusé).
app.post('/api/admin/emails/announce-arena', requireAdmin, async (req, res) => {
  const competitionId = String(req.body?.competitionId || '').trim();
  if (!competitionId) {
    res.status(400).json({ error: 'competitionId requis' });
    return;
  }
  try {
    if (IS_SERVERLESS) await competitionManager.refresh();
    const result = await competitionNotifier.announceNewArena(competitionId);
    if (!result.ok) {
      const messages: Record<string, string> = {
        'mailer-off': 'Service email non configuré (RESEND_API_KEY manquant).',
        blocked: 'Le type « Nouvelle arène » est sur Bloqué dans les réglages. Mets-le sur Actif ou Test.',
        'not-found': 'Arène introuvable.',
      };
      res.status(400).json({ error: messages[result.reason || ''] || 'Envoi impossible', ...result });
      return;
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error)?.message || 'Envoi impossible' });
  }
});

// Métriques runtime pour surveiller la charge en direct (connexions WS, pools
// Postgres, traders actifs). Lecture seule, admin uniquement.
app.get('/api/admin/metrics', requireAdmin, (_req, res) => {
  let arenaSockets = 0;
  const arenaByCompetition: Array<{ competitionId: string; sockets: number }> = [];
  for (const [competitionId, sockets] of arenaClients) {
    arenaSockets += sockets.size;
    arenaByCompetition.push({ competitionId, sockets: sockets.size });
  }
  arenaByCompetition.sort((a, b) => b.sockets - a.sockets);

  const mem = process.memoryUsage();
  const playerStats = manager.getRuntimeStats();
  const compStats = competitionManager.getRuntimeStats();

  res.json({
    at: Date.now(),
    uptimeSec: Math.round(process.uptime()),
    serverless: IS_SERVERLESS,
    memoryMB: {
      rss: Math.round(mem.rss / 1048576),
      heapUsed: Math.round(mem.heapUsed / 1048576),
      heapTotal: Math.round(mem.heapTotal / 1048576),
      external: Math.round(mem.external / 1048576),
    },
    websockets: {
      total: clients.size,
      paperTraders: paperClients.size,
      arenaCompetitions: arenaClients.size,
      arenaSockets,
      arenaByCompetition: arenaByCompetition.slice(0, 20),
    },
    traders: {
      tracked: playerStats.trackedPlayers,
      active: playerStats.activePlayers,
      withOpenPositions: playerStats.withOpenPositions,
    },
    competitions: {
      total: compStats.competitions,
      live: compStats.liveCompetitions,
      users: compStats.users,
    },
    pools: {
      competition: compStats.pool,
      roster: playerStats.pool,
      candles: cryptoCandlesStore.getCandlesPoolStats(),
      marketMetadata: getMarketMetadataPoolStats(),
      promotions: promotionsStore.getPromotionsPoolStats(),
      email: getEmailPoolStats(),
    },
  });
});

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
/**
 * Agrège les trades de plusieurs paper players (toutes les arènes d'un user)
 * et calcule les stats globales (winrate, RR moyen, profit factor...).
 */
function aggregateStatsForPlayerIds(paperPlayerIds: string[]): TradeStats {
  const trades: Trade[] = [];
  for (const id of paperPlayerIds) {
    const player = manager.getPlayerById(id);
    if (player?.trades?.length) trades.push(...player.trades);
  }
  return computeTradeStats(trades);
}

/**
 * Journal de trades personnel : tous les trades (opens + closes) de
 * l'utilisateur, toutes arènes confondues (hors qualifications), rattachés à
 * leur arène. Les opens sont inclus car ils portent les frais d'entrée :
 * trade.pnl est un PnL prix pur (cf. exchangePaperEngine), le client déduit
 * les frais (opens + closes) pour une courbe d'équité et des stats nettes.
 * Triés par date croissante pour un cumul direct côté client.
 */
app.get('/api/competition/my-trades', async (req, res) => {
  const user = await getCompetitionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Session invalide' });
    return;
  }
  if (IS_SERVERLESS) await competitionManager.refresh();
  const links = competitionManager.listUserArenaPlayers(user.id);
  const trades: Array<{
    id: string;
    competitionId: string;
    competitionTitle: string;
    pair: string;
    side: 'long' | 'short';
    action: 'open' | 'close';
    size: number;
    price: number;
    entryPrice?: number;
    leverage: number;
    fee: number;
    pnl: number;
    time: number;
  }> = [];
  for (const link of links) {
    const player = manager.getPlayerById(link.paperPlayerId);
    if (!player?.trades?.length) continue;
    for (const trade of player.trades) {
      if (trade.action !== 'close' && trade.action !== 'open') continue;
      trades.push({
        id: trade.id,
        competitionId: link.competitionId,
        competitionTitle: link.competitionTitle,
        pair: trade.pair,
        side: trade.side,
        action: trade.action,
        size: trade.size,
        price: trade.price,
        entryPrice: typeof trade.entryPrice === 'number' ? trade.entryPrice : undefined,
        leverage: trade.leverage,
        fee: Number(trade.fee) || 0,
        pnl: Number(trade.pnl) || 0,
        time: trade.time,
      });
    }
  }
  trades.sort((a, b) => a.time - b.time);
  res.json({ trades });
});

/**
 * Profil public d'un joueur : consultable par tout le monde (pas d'auth).
 * Ne contient jamais d'info sensible (email, téléphone).
 */
app.get('/api/competition/player/:userId', async (req, res) => {
  if (IS_SERVERLESS) await competitionManager.refresh();
  const userId = String(req.params.userId || '');
  const profile = competitionManager.getPublicPlayerProfile(userId);
  if (!profile) {
    res.status(404).json({ error: 'Joueur introuvable' });
    return;
  }
  const { paperPlayerIds, ...rest } = profile;
  const rating = await syncUserRating(userId, competitionManager.getUserArenaResults(userId)).catch(() => null);
  res.json({ ...rest, rating, stats: aggregateStatsForPlayerIds(paperPlayerIds) });
});

app.get('/api/competition/global-leaderboard', async (req, res) => {
  if (IS_SERVERLESS) await competitionManager.refresh();
  const scope = String(req.query.scope || '').trim();
  const lite = String(req.query.fields || '').trim() === 'lite' || req.query.lite === '1';

  const buildRows = (participations: ReturnType<typeof competitionManager.listUserParticipations>) => {
    const rows = participations.map((p) => {
      const stats = lite ? null : aggregateStatsForPlayerIds(p.paperPlayerIds);
      return {
        userId: p.userId,
        name: p.name,
        avatarUrl: p.avatarUrl,
        country: p.country,
        badges: lite ? undefined : p.badges,
        pnlUsd: p.pnlUsd,
        arenas: p.arenas,
        ...(stats ? { stats } : {}),
      };
    });
    rows.sort((a, b) => {
      if (!lite) {
        const aActive = a.stats && a.stats.closedTrades > 0 ? 1 : 0;
        const bActive = b.stats && b.stats.closedTrades > 0 ? 1 : 0;
        if (aActive !== bActive) return bActive - aActive;
      }
      return b.pnlUsd - a.pnlUsd;
    });
    return rows;
  };

  res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');

  // Classement all-time : toutes les arènes (hors qualifications), toutes saisons.
  if (scope === 'all') {
    res.json({
      scope: 'all',
      rows: buildRows(competitionManager.listUserParticipations({ includeBadges: !lite })),
    });
    return;
  }

  const seasonParam = String(req.query.season || '').trim();
  const activeSeason = competitionManager.getActiveSeason();
  const season = seasonParam
    ? competitionManager.getSeason(seasonParam)
    : activeSeason;
  if (!season) {
    res.status(404).json({ error: 'Saison introuvable' });
    return;
  }
  res.json({
    scope: 'season',
    season: {
      id: season.id,
      slug: season.slug,
      nameKey: season.nameKey,
      startAt: season.startAt,
      endAt: season.endAt,
      isActive: season.isActive,
      theme: season.theme,
      championBadge: season.championBadge,
      rewardEyebrowKey: season.rewardEyebrowKey,
      rewardTitleKey: season.rewardTitleKey,
      rewardDescKey: season.rewardDescKey,
      bannerImage: season.bannerImage ?? null,
      shirtImage: season.shirtImage ?? null,
      arenaImage: season.arenaImage ?? null,
      status: inferSeasonStatus(season),
    },
    rows: buildRows(competitionManager.listUserParticipations({
      seasonId: season.id,
      includeBadges: !lite,
    })),
  });
});

app.get('/api/competition/seasons', async (_req, res) => {
  if (IS_SERVERLESS) await competitionManager.refresh();
  res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
  const seasons = competitionManager.listSeasons().map((season) => ({
    id: season.id,
    slug: season.slug,
    nameKey: season.nameKey,
    startAt: season.startAt,
    endAt: season.endAt,
    isActive: season.isActive,
    theme: season.theme,
    championBadge: season.championBadge,
    rewardEyebrowKey: season.rewardEyebrowKey,
    rewardTitleKey: season.rewardTitleKey,
    rewardDescKey: season.rewardDescKey,
    bannerImage: season.bannerImage ?? null,
    shirtImage: season.shirtImage ?? null,
    arenaImage: season.arenaImage ?? null,
    homeBannerImage: season.homeBannerImage ?? null,
    status: inferSeasonStatus(season),
  }));
  res.json({ seasons, activeSeasonId: competitionManager.getActiveSeason()?.id ?? null });
});

app.get('/api/competition/bootstrap', async (req, res) => {
  if (IS_SERVERLESS) await competitionManager.refresh();
  const [user] = await Promise.all([
    getCompetitionUser(req),
    maybeFinalizeEndedCompetitions(),
  ]);
  const publicCompetitions = competitionManager.listPublicCompetitions();
  const myCompetitions = user ? competitionManager.listUserCompetitions(user.id) : [];
  const myStats = user
    ? aggregateStatsForPlayerIds(competitionManager.getPaperPlayerIdsForUserStats(user.id))
    : null;
  const myBadges = user ? competitionManager.getUserBadges(user.id) : [];
  const myRating = user
    ? await syncUserRating(user.id, competitionManager.getUserArenaResults(user.id))
    : null;
  const claimablePayouts = user ? competitionManager.countClaimablePayoutsForUser(user.id) : 0;
  const myTeam = user ? competitionManager.getUserTeam(user.id) : null;
  res.json({
    user,
    publicCompetitions,
    myCompetitions,
    myStats,
    myBadges,
    myRating,
    claimablePayouts,
    myTeam,
  });
});

/**
 * Classement mondial BTF Rating (Arena Points). Public : sert l'onglet Rank.
 * Les identités (nom/avatar) sont résolues via les participations connues.
 */
let ratingBackfillAt = 0;
let ratingBackfillInFlight: Promise<void> | null = null;
const RATING_BACKFILL_EVERY_MS = 5 * 60_000;

async function ensureRatingsBackfilled(): Promise<void> {
  if (Date.now() - ratingBackfillAt < RATING_BACKFILL_EVERY_MS) return;
  if (ratingBackfillInFlight) return ratingBackfillInFlight;
  ratingBackfillInFlight = (async () => {
    const userIds = competitionManager.listEndedArenaUserIds();
    await syncManyUserRatings(userIds.map((userId) => ({
      userId,
      results: competitionManager.getUserArenaResults(userId),
    })));
    ratingBackfillAt = Date.now();
  })().finally(() => {
    ratingBackfillInFlight = null;
  });
  return ratingBackfillInFlight;
}

app.get('/api/competition/rating-leaderboard', async (_req, res) => {
  if (IS_SERVERLESS) await competitionManager.refresh();
  void ensureRatingsBackfilled();
  const rows = await getRatingLeaderboard(100);
  const identities = new Map(
    competitionManager.listUserParticipations({ includeBadges: false }).map((participation) => [participation.userId, participation]),
  );
  res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
  res.json({
    rows: rows.map((row, index) => {
      const identity = identities.get(row.userId);
      return {
        rank: index + 1,
        userId: row.userId,
        name: identity?.name || 'Trader BTF',
        avatarUrl: identity?.avatarUrl ?? null,
        country: identity?.country ?? null,
        points: row.points,
        division: row.division,
      };
    }),
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
    await refreshCompetitionStoreIfServerless();
    const competition = competitionManager.joinCompetition(
      user.id,
      String(req.body?.code || ''),
      req.body?.sponsorAccountId,
      req.body?.competitionId,
    );
    await competitionManager.persist();
    res.json({ ok: true, competitionId: competition.id });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Join impossible' });
  }
});

app.get('/api/competition/teams/mine', async (req, res) => {
  const user = await getCompetitionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Session invalide' });
    return;
  }
  res.json({ team: competitionManager.getUserTeam(user.id) });
});

app.post('/api/competition/teams', async (req, res) => {
  res.status(403).json({ error: 'La création d’équipes est temporairement désactivée.' });
});

app.post('/api/competition/teams/join', async (req, res) => {
  const user = await getCompetitionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Session invalide' });
    return;
  }
  try {
    const team = competitionManager.joinTeamByCode(user.id, req.body?.code);
    await competitionManager.persist();
    res.json({ team });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Invitation invalide' });
  }
});

app.post('/api/competition/teams/:id/kick', async (req, res) => {
  const user = await getCompetitionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Session invalide' });
    return;
  }
  try {
    const team = competitionManager.kickTeamMember(user.id, String(req.params.id || ''), String(req.body?.userId || ''));
    await competitionManager.persist();
    res.json({ team });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Exclusion impossible' });
  }
});

app.post('/api/competition/teams/:id/leave', async (req, res) => {
  const user = await getCompetitionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Session invalide' });
    return;
  }
  try {
    const team = competitionManager.leaveTeam(user.id, String(req.params.id || ''));
    await competitionManager.persist();
    res.json({ team });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Départ impossible' });
  }
});

app.post('/api/competition/teams/:id/image', upload.single('image'), async (req, res) => {
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
    const team = await competitionManager.setTeamImageBlob(
      user.id,
      String(req.params.id || ''),
      optimized.mime,
      optimized.buffer,
    );
    invalidateBlobCache(`team-image:${req.params.id}`);
    await competitionManager.persist();
    res.json({ team });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Badge d’équipe impossible à modifier' });
  }
});

app.get('/api/team-images/:teamId', async (req, res) => {
  const teamId = String(req.params.teamId);
  try {
    await sendImageBlob(
      res,
      `team-image:${teamId}`,
      () => competitionManager.getTeamImageBlob(teamId),
      String(req.query.w || ''),
    );
  } catch (error: any) {
    console.error(`[team-images] failed teamId=${teamId}:`, error?.message);
    res.status(500).json({ error: error.message || 'Lecture impossible' });
  }
});

app.post('/api/competition/teams/:id/register', async (req, res) => {
  const user = await getCompetitionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Session invalide' });
    return;
  }
  try {
    await refreshCompetitionStoreIfServerless();
    const competition = competitionManager.registerTeamToCompetition(
      user.id,
      String(req.params.id || ''),
      String(req.body?.competitionId || ''),
      req.body?.sponsorAccountId,
    );
    await competitionManager.persist();
    res.json({ ok: true, competitionId: competition.id });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Inscription d’équipe impossible' });
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
    const breached = competitionManager.isPaperPlayerBreached(competition.id, player.id);
    const competitionContext = competitionManager.getCompetitionContextForPaperPlayer(competition.id, player.id) || {
      id: competition.id,
      title: competition.title,
      executionMode: competition.executionMode,
    };

    res.json({
      token,
      player: publicPlayer,
      canTrade: competitionStatus === 'live' && !breached,
      competition: competitionContext,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Session de trading competition impossible' });
  }
});

function lastPaperTradeAt(paperPlayerId?: string | null): number | null {
  if (!paperPlayerId) return null;
  const player = manager.getPlayerById(paperPlayerId);
  let last = 0;
  for (const trade of player?.trades || []) {
    const time = Number(trade.time) || 0;
    if (time > last) last = time;
  }
  return last || null;
}

async function decoratePublicLeaderboard(
  competitionId: string,
  data: ReturnType<typeof competitionManager.getPublicLeaderboard>,
) {
  const ratings = await getRatingSnapshots().catch(() => new Map());
  const paperByUser = new Map(
    competitionManager.listCompetitionRoster(competitionId).map((member) => [member.userId, member.paperPlayerId]),
  );
  return {
    ...data,
    leaderboard: data.leaderboard.map((row) => {
      const rating = ratings.get(row.userId);
      const memberTimes = (row.members || [])
        .map((member) => lastPaperTradeAt(paperByUser.get(member.userId)))
        .filter((time): time is number => Boolean(time));
      const lastTrade = memberTimes.length
        ? Math.max(...memberTimes)
        : lastPaperTradeAt(paperByUser.get(row.userId));
      return {
        ...row,
        lastActivityAt: lastTrade || row.lastActivityAt || null,
        worldRank: rating?.worldRank ?? null,
        division: rating?.division ?? { id: 'bronze', label: 'Bronze', tier: 0 },
      };
    }),
  };
}

app.get('/api/competition/leaderboard/:id', async (req, res) => {
  try {
    const competitionId = String(req.params.id || '');
    await syncCompetitionResultsForCompetition(competitionId);
    const data = competitionManager.getPublicLeaderboard(competitionId);
    if (data.competition.status === 'live') {
      maybeRecordPnlSample(competitionId, data.leaderboard, { startAt: data.competition.startAt });
    }
    res.json(await decoratePublicLeaderboard(competitionId, data));
  } catch (error: any) {
    res.status(404).json({ error: error.message || 'Leaderboard introuvable' });
  }
});

/**
 * Historique PnL pour le mode spectateur : séries échantillonnées (~30 s)
 * du PnL % du top 10, plus l'identité des traders suivis pour tracer les
 * courbes avec avatars côté client.
 */
const pnlHistoryResponseCache = new Map<string, { at: number; body: unknown }>();
const PNL_HISTORY_CACHE_MS = 8_000;
const pnlTradeBackfillAttempted = new Set<string>();
const PNL_BACKFILL_MAX_INITIAL_GAP_MS = 60 * 60 * 1000;

type PublicPnlHistoryBody = {
  status: string;
  samples: Array<{ t: number; rows: Array<{ userId: string; pnlPercent: number }> }>;
  moments: Array<{ t: number; type: string; userId: string }>;
  traders: unknown[];
  cursor: number;
};

function incrementalPnlHistory(body: PublicPnlHistoryBody, after: number): PublicPnlHistoryBody {
  if (after <= 0) return body;
  return {
    ...body,
    samples: body.samples.filter((sample) => sample.t > after),
    moments: body.moments.filter((moment) => moment.t > after),
  };
}

app.get('/api/competition/leaderboard/:id/pnl-history', async (req, res) => {
  try {
    const competitionId = String(req.params.id || '');
    const after = Math.max(0, Number(req.query.after) || 0);
    const cached = pnlHistoryResponseCache.get(competitionId);
    if (cached && Date.now() - cached.at < PNL_HISTORY_CACHE_MS) {
      res.setHeader('Cache-Control', 'public, max-age=2, s-maxage=8, stale-while-revalidate=30');
      res.json(incrementalPnlHistory(cached.body as PublicPnlHistoryBody, after));
      return;
    }
    const data = competitionManager.getPublicLeaderboard(competitionId);
    const storedHistory = getPnlHistory(competitionId);
    const firstRecordedPoint = storedHistory.find((sample) => sample.t > data.competition.startAt + 1_000);
    const missingEarlyHistory = Boolean(
      firstRecordedPoint
      && firstRecordedPoint.t - data.competition.startAt > PNL_BACKFILL_MAX_INITIAL_GAP_MS,
    );
    const shouldReconstruct = !hasPnlHistory(competitionId)
      || (
        data.competition.status === 'live'
        && missingEarlyHistory
        && !pnlTradeBackfillAttempted.has(competitionId)
      );

    if (shouldReconstruct) {
      pnlTradeBackfillAttempted.add(competitionId);
      const paperByUser = new Map(
        competitionManager.getCompetitionPaperPlayers(competitionId).map((link) => [link.userId, link.paperPlayerId]),
      );
      const startingBalance = manager.getCompetitionStartingBalance();
      const tracked = data.leaderboard.filter((row) => row.rank > 0).slice(0, 40);
      reconstructPnlHistoryFromTrades(
        competitionId,
        data.competition.startAt,
        data.competition.endAt,
        startingBalance,
        tracked.map((row) => {
          const paperPlayerId = paperByUser.get(row.userId);
          const player = paperPlayerId ? manager.getPlayerById(paperPlayerId) : null;
          return {
            userId: row.userId,
            trades: (player?.trades || []).map((trade) => ({
              time: trade.time,
              action: trade.action,
              pnl: trade.pnl,
            })),
            openPositions: (player?.openPositions || []).map((position) => ({
              openedAt: position.openedAt || data.competition.startAt,
              pnl: position.pnl,
            })),
            finalPnlPercent: row.pnlPercent,
          };
        }),
        Date.now(),
        hasPnlHistory(competitionId),
      );
    }
    if (data.competition.status === 'live') {
      maybeRecordPnlSample(competitionId, data.leaderboard, { startAt: data.competition.startAt });
    }
    // Toujours terminer la série par un point « maintenant » issu du
    // leaderboard courant : la courbe est visible dès les premiers polls
    // au lieu d'attendre plusieurs échantillons throttlés.
    const samples = slimPublicPnlHistory(
      getPnlHistoryWithLivePoint(competitionId, data.leaderboard),
      data.leaderboard,
    );
    const tracked = new Set(samples.flatMap((sample) => sample.rows.map((row) => row.userId)));
    const body: PublicPnlHistoryBody = {
      status: data.competition.status,
      samples,
      moments: getPnlMoments(competitionId),
      traders: data.leaderboard
        .filter((row) => tracked.has(row.userId))
        .map((row) => ({
          userId: row.userId,
          name: row.name,
          avatarUrl: row.avatarUrl,
          rank: row.rank,
          pnlPercent: row.pnlPercent,
          breached: row.breached,
        })),
      cursor: samples[samples.length - 1]?.t || 0,
    };
    pnlHistoryResponseCache.set(competitionId, { at: Date.now(), body });
    res.setHeader(
      'Cache-Control',
      data.competition.status === 'ended'
        ? 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400'
        : 'public, max-age=2, s-maxage=8, stale-while-revalidate=30',
    );
    res.json(incrementalPnlHistory(body, after));
  } catch (error: any) {
    res.status(404).json({ error: error.message || 'Historique introuvable' });
  }
});

/**
 * Flux d'activité public d'une arène : « X vient de prendre un trade sur Bitcoin ».
 * L'anonymisation est faite ici, jamais côté client : la réponse ne contient ni
 * sens (long/short), ni taille, ni prix, ni levier — seulement qui, quand et sur
 * quel marché.
 */
const activityResponseCache = new Map<string, { at: number; body: unknown }>();
const ACTIVITY_CACHE_MS = 4_000;
const ACTIVITY_LIMIT = 25;
type PublicArenaActivity = {
  id: string;
  t: number;
  action: 'open' | 'close';
  pair: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
};
const simulatedActivityByCompetition = new Map<string, PublicArenaActivity[]>();

app.get('/api/competition/leaderboard/:id/activity', async (req, res) => {
  try {
    const competitionId = String(req.params.id || '');
    const cached = activityResponseCache.get(competitionId);
    if (cached && Date.now() - cached.at < ACTIVITY_CACHE_MS) {
      res.json(cached.body);
      return;
    }
    if (IS_SERVERLESS) await competitionManager.refresh();

    const recent: PublicArenaActivity[] = [];
    for (const member of competitionManager.listCompetitionRoster(competitionId)) {
      const player = manager.getPlayerById(member.paperPlayerId);
      for (const trade of player?.trades ?? []) {
        if (trade.action !== 'open' && trade.action !== 'close') continue;
        recent.push({
          id: trade.id,
          t: trade.time,
          action: trade.action,
          pair: trade.pair,
          userId: member.userId,
          name: member.name,
          avatarUrl: member.avatarUrl,
        });
      }
    }
    recent.push(...(simulatedActivityByCompetition.get(competitionId) || []));
    recent.sort((a, b) => b.t - a.t);
    const events = recent.slice(0, ACTIVITY_LIMIT);
    const metadata = await getMarketMetadata([...new Set(events.map((event) => event.pair))]);

    const body = {
      events: events.map((event) => ({
        id: event.id,
        t: event.t,
        action: event.action,
        userId: event.userId,
        name: event.name,
        avatarUrl: event.avatarUrl,
        asset: metadata[event.pair]?.name || event.pair.split('/')[0] || event.pair,
        assetImageUrl: metadata[event.pair]?.imageUrl ?? null,
      })),
    };
    activityResponseCache.set(competitionId, { at: Date.now(), body });
    res.json(body);
  } catch (error: any) {
    res.status(404).json({ error: error.message || 'Activité introuvable' });
  }
});

/** Champion of the Week : vainqueur de la dernière Friday Night Arena terminée. */
app.get('/api/competition/champion-of-week', async (_req, res) => {
  try {
    await refreshCompetitionStoreIfServerless();
    res.json({ champion: competitionManager.getChampionOfTheWeek() });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Champion introuvable' });
  }
});

// Échantillonneur d'arrière-plan : construit l'historique PnL des arènes live
// même sans spectateur connecté. Serveur persistant uniquement (Railway) —
// en serverless, l'échantillonnage se fait au fil des GET leaderboard.
if (!process.env.NETLIFY) {
  const watchTimer = setInterval(() => {
    try { broadcastMarketWatch(); } catch { /* watchlist best-effort */ }
  }, MARKET_WATCH_MS);
  if (typeof watchTimer.unref === 'function') watchTimer.unref();
}

if (!process.env.NETLIFY) {
  setInterval(() => {
    void (async () => {
      const publicCompetitions = competitionManager.listPublicCompetitions();
      prunePnlHistories(new Set(publicCompetitions.map((competition) => competition.id)));
      for (const competition of publicCompetitions) {
        if (competition.status !== 'live') continue;
        try {
          await syncCompetitionResultsForCompetition(competition.id);
          maybeRecordPnlSample(competition.id, competitionManager.getPublicLeaderboard(competition.id).leaderboard, {
            startAt: competition.startAt,
          });
        } catch {
          // Arène retirée ou sync impossible : on passe.
        }
      }
    })();
  }, 10_000);
}

// Scheduler des arènes programmées : Blitz quotidiennes (London/NY/Crypto)
// et FRIDAY NIGHT ARENA hebdomadaire. Serveur persistant uniquement — la
// création est idempotente (scheduleKey persistée), donc un redémarrage ou
// plusieurs instances ne créent pas de doublons.
if (!process.env.NETLIFY) {
  const runScheduler = () => {
    void ensureScheduledArenas(competitionManager).catch((error) => {
      console.warn('[arenaScheduler] échec de création des arènes programmées :', error?.message || error);
    });
  };
  setTimeout(runScheduler, 10_000);
  setInterval(runScheduler, 10 * 60_000);
}

// Simulation visuelle contrôlée manuellement, disponible uniquement sur le
// staging. Elle ne démarre jamais au boot : un appel admin explicite est requis.
const STAGING_SIMULATION_TITLE = 'STAGING — PNL RACE LIVE TEST';
const STAGING_SIMULATION_TICK_MS = 2_000;
const STAGING_SIMULATION_ASSETS = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'DOGE/USD', 'TRX/USD'];
const STAGING_SIMULATION_BOTS = [
  { userId: 'sim-live-nova', name: 'NovaQuant', drift: 0.08, vol: 0.9 },
  { userId: 'sim-live-wolf', name: 'KryptoWolf', drift: 0.04, vol: 1.2 },
  { userId: 'sim-live-lisa', name: 'Lisa.eth', drift: 0.03, vol: 0.65 },
  { userId: 'sim-live-scalp', name: 'ScalpKing', drift: -0.02, vol: 1.4 },
  { userId: 'sim-live-moon', name: 'MoonRider', drift: 0.05, vol: 1.0 },
  { userId: 'sim-live-zen', name: 'ZenTrader', drift: 0.01, vol: 0.55 },
  { userId: 'sim-live-degen', name: 'DegenMax', drift: -0.04, vol: 1.6 },
  { userId: 'sim-live-alpha', name: 'AlphaFlow', drift: 0.07, vol: 0.8 },
  { userId: 'sim-live-satoshi', name: 'SatoshiKid', drift: 0.02, vol: 1.1 },
  { userId: 'sim-live-pulse', name: 'MarketPulse', drift: 0.04, vol: 0.75 },
] as const;

type StagingSimulationState = {
  competitionId: string;
  startedAt: number;
  timer: ReturnType<typeof setInterval>;
  bots: Map<string, { pnlPercent: number; tradesCount: number }>;
};
let stagingSimulation: StagingSimulationState | null = null;

function assertStagingSimulationAvailable(): void {
  if (!MOBILE_STAGING_TEST_MODE || process.env.NETLIFY) {
    throw new Error('Simulation disponible uniquement sur le staging Railway');
  }
}

function runStagingSimulationTick(state: StagingSimulationState): void {
  const current = competitionManager.getPublicLeaderboard(state.competitionId);
  const updates = STAGING_SIMULATION_BOTS.map((bot) => {
    let botState = state.bots.get(bot.userId);
    if (!botState) {
      const existing = current.leaderboard.find((row) => row.userId === bot.userId);
      botState = existing
        ? { pnlPercent: existing.pnlPercent, tradesCount: Math.max(1, existing.tradesCount) }
        : { pnlPercent: (Math.random() - 0.42) * 8, tradesCount: 5 + Math.floor(Math.random() * 20) };
      state.bots.set(bot.userId, botState);
    }
    botState.pnlPercent = Math.max(-18, Math.min(35,
      botState.pnlPercent + bot.drift + (Math.random() - 0.5) * bot.vol,
    ));
    botState.tradesCount += 1 + Math.floor(Math.random() * 3);
    return {
      userId: bot.userId,
      name: bot.name,
      pnlPercent: Number(botState.pnlPercent.toFixed(3)),
      pnlUsd: Number((botState.pnlPercent * 100).toFixed(2)),
      tradesCount: botState.tradesCount,
    };
  });

  competitionManager.applySimulatedResults(state.competitionId, updates);
  const next = competitionManager.getPublicLeaderboard(state.competitionId);
  maybeRecordPnlSample(state.competitionId, next.leaderboard, { startAt: next.competition.startAt });

  const now = Date.now();
  const activity = simulatedActivityByCompetition.get(state.competitionId) || [];
  const eventCount = 3 + Math.floor(Math.random() * 4);
  for (let index = 0; index < eventCount; index += 1) {
    const bot = STAGING_SIMULATION_BOTS[Math.floor(Math.random() * STAGING_SIMULATION_BOTS.length)];
    const pair = STAGING_SIMULATION_ASSETS[Math.floor(Math.random() * STAGING_SIMULATION_ASSETS.length)];
    activity.unshift({
      id: `sim-${now}-${index}-${Math.random().toString(36).slice(2, 8)}`,
      t: now - index * 120,
      action: Math.random() < 0.55 ? 'open' : 'close',
      pair,
      userId: bot.userId,
      name: bot.name,
      avatarUrl: null,
    });
  }
  simulatedActivityByCompetition.set(state.competitionId, activity.slice(0, 60));
  activityResponseCache.delete(state.competitionId);
  pnlHistoryResponseCache.delete(state.competitionId);
}

async function startStagingSimulation(): Promise<{ competitionId: string; startedAt: number }> {
  assertStagingSimulationAvailable();
  if (stagingSimulation) {
    return { competitionId: stagingSimulation.competitionId, startedAt: stagingSimulation.startedAt };
  }

  const now = Date.now();
  const existingCompetition = competitionManager
    .listAdminCompetitions()
    .find((item) => item.title === STAGING_SIMULATION_TITLE && item.status === 'live');
  let competitionId = existingCompetition?.id || '';
  if (!competitionId) {
    const created = competitionManager.createCompetition({
      title: STAGING_SIMULATION_TITLE,
      code: '',
      executionMode: 'paper',
      startAt: now - 5 * 60_000,
      endAt: now + 6 * 60 * 60_000,
      registrationEndsAt: now - 60_000,
      dailyDrawdownPercent: null,
      isPublic: true,
      cashPrize: { label: 'Simulation', total: 10_000, currency: 'USD' },
    });
    competitionId = created.id;
    await competitionManager.persist();
  }

  const state: StagingSimulationState = {
    competitionId,
    startedAt: now,
    timer: 0 as unknown as ReturnType<typeof setInterval>,
    bots: new Map(),
  };
  runStagingSimulationTick(state);
  state.timer = setInterval(() => {
    try {
      runStagingSimulationTick(state);
    } catch (error) {
      console.warn('[staging-simulation] tick failed:', (error as Error).message);
    }
  }, STAGING_SIMULATION_TICK_MS);
  stagingSimulation = state;
  return { competitionId: state.competitionId, startedAt: state.startedAt };
}

async function stopStagingSimulation(removeArena: boolean): Promise<{ competitionId: string | null; removed: boolean }> {
  assertStagingSimulationAvailable();
  const competitionId = stagingSimulation?.competitionId
    || competitionManager.listAdminCompetitions()
      .find((item) => item.title === STAGING_SIMULATION_TITLE && item.status === 'live')?.id
    || null;
  if (stagingSimulation) clearInterval(stagingSimulation.timer);
  stagingSimulation = null;
  if (competitionId) {
    simulatedActivityByCompetition.delete(competitionId);
    activityResponseCache.delete(competitionId);
    if (removeArena) {
      competitionManager.deleteCompetition(competitionId);
      await competitionManager.persist();
    }
  }
  return { competitionId, removed: Boolean(competitionId && removeArena) };
}

app.get('/api/admin/staging-simulation', requireAdmin, (_req, res) => {
  try {
    assertStagingSimulationAvailable();
    const existingCompetitionId = stagingSimulation?.competitionId
      || competitionManager.listAdminCompetitions()
        .find((item) => item.title === STAGING_SIMULATION_TITLE && item.status === 'live')?.id
      || null;
    res.json({
      running: Boolean(stagingSimulation),
      competitionId: existingCompetitionId,
      startedAt: stagingSimulation?.startedAt || null,
      traders: STAGING_SIMULATION_BOTS.length,
      tickMs: STAGING_SIMULATION_TICK_MS,
    });
  } catch (error) {
    res.status(404).json({ error: (error as Error).message });
  }
});

app.get('/api/staging/runtime-metrics', (_req, res) => {
  if (!MOBILE_STAGING_TEST_MODE || process.env.NETLIFY) {
    res.status(404).json({ error: 'Indisponible' });
    return;
  }
  const memory = process.memoryUsage();
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    uptime: process.uptime(),
    memory: {
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
      external: memory.external,
      arrayBuffers: memory.arrayBuffers,
    },
    sockets: {
      total: wss.clients.size,
      global: clients.size,
      paper: paperClients.size,
      arena: Array.from(arenaClients.values()).reduce((total, bucket) => total + bucket.size, 0),
      chat: chatWss.clients.size,
    },
    wsMaxBufferedBytes: WS_MAX_BUFFERED_BYTES,
  });
});

app.post('/api/admin/staging-simulation/start', requireAdmin, async (_req, res) => {
  try {
    const simulation = await startStagingSimulation();
    res.json({ ok: true, running: true, traders: STAGING_SIMULATION_BOTS.length, ...simulation });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.post('/api/admin/staging-simulation/stop', requireAdmin, async (req, res) => {
  try {
    const result = await stopStagingSimulation(req.body?.removeArena === true);
    res.json({ ok: true, running: false, ...result });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
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

/**
 * Relit le terminal paper d'un joueur sur une arène (défaut : dernière
 * terminée). Admin only — journal complet d'un autre compte.
 */
app.get('/api/admin/competition/player-terminal', requireAdmin, async (req, res) => {
  if (IS_SERVERLESS) await competitionManager.refresh();
  const name = String(req.query.name || 'SnorkyFab').trim();
  const userIdQuery = String(req.query.userId || '').trim();
  const competitionId = String(req.query.competitionId || '').trim();

  const user = userIdQuery
    ? competitionManager.getUserById(userIdQuery)
    : competitionManager.findUserByDisplayName(name);
  if (!user) {
    res.status(404).json({ error: `Joueur introuvable : ${userIdQuery || name}` });
    return;
  }

  const arenas = competitionManager.listUserReviewArenas(user.id);
  if (arenas.length === 0) {
    res.status(404).json({ error: `${user.name} n'a aucune arène (hors qualification)` });
    return;
  }

  const ended = arenas.filter((arena) => arena.status === 'ended');
  const selected = (competitionId && arenas.find((arena) => arena.id === competitionId))
    || ended[0]
    || arenas[0];

  const paperPlayer = selected.paperPlayerId
    ? manager.getPlayerById(selected.paperPlayerId)
    : null;
  const startingBalance = manager.getCompetitionStartingBalance();
  const fallbackBalance = startingBalance + selected.pnlUsd;
  const player = paperPlayer
    ? publicPlayer(paperPlayer)
    : {
        id: selected.paperPlayerId || `missing-${user.id}`,
        name: user.name,
        color: '#dc2626',
        avatar: user.avatarUrl || null,
        active: false,
        initialBalance: startingBalance,
        currentBalance: fallbackBalance,
        availableMargin: fallbackBalance,
        usedMargin: 0,
        feesPaid: 0,
        pnl: selected.pnlUsd,
        pnlPercent: selected.pnlPercent,
        tradeCount: selected.tradesCount,
        trades: [],
        openPositions: [],
        openOrders: [],
        rank: selected.rank || 1,
        previousRank: selected.rank || 1,
        badges: [],
        winStreak: 0,
        longestPositionMinutes: 0,
        biggestTradePnl: 0,
        bestTradePercent: 0,
        lastUpdate: Date.now(),
        connected: false,
      };

  res.json({
    user: {
      id: user.id,
      name: user.name,
      avatarUrl: user.avatarUrl || null,
    },
    competition: selected,
    arenas,
    player,
    startingBalance,
    missingPaper: !paperPlayer,
  });
});

app.get('/api/admin/competitions', requireAdmin, async (_req, res) => {
  await syncAllCompetitionResults();
  res.json({
    competitions: competitionManager.listAdminCompetitions(),
    seasons: competitionManager.listSeasons(),
  });
});

app.post('/api/admin/competitions', requireAdmin, async (req, res) => {
  const { title, code, executionMode, startAt, endAt, registrationEndsAt, dailyDrawdownPercent, bannerImageUrl, bannerHref, isPublic, cashPrize, sponsor, sponsorReferralUrl, sponsorName, sponsorLogoUrl, hostLogoUrl, promoTitle, promoSubtitle, promoHref, promoCta, promoOffer1, promoCode1, promoOffer2, promoCode2, seasonId } = req.body || {};
  try {
    const competition = competitionManager.createCompetition({
      title: String(title || ''),
      code: String(code || ''),
      executionMode: executionMode === 'real' ? 'real' : 'paper',
      startAt: Number(startAt),
      endAt: Number(endAt),
      registrationEndsAt,
      dailyDrawdownPercent,
      bannerImageUrl,
      bannerHref,
      isPublic: Boolean(isPublic),
      cashPrize,
      sponsor,
      sponsorReferralUrl,
      sponsorName,
      sponsorLogoUrl,
      hostLogoUrl,
      promoTitle,
      promoSubtitle,
      promoHref,
      promoCta,
      promoOffer1,
      promoCode1,
      promoOffer2,
      promoCode2,
      seasonId,
      entryMode: req.body?.entryMode,
    });
    await competitionManager.persist();
    void syncLiveMarketFeeds();
    res.json({ ok: true, competition });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Creation competition impossible' });
  }
});

app.patch('/api/admin/competitions/:id', requireAdmin, async (req, res) => {
  const body = req.body || {};
  const { title, code, executionMode, startAt, endAt, registrationEndsAt, dailyDrawdownPercent, bannerImageUrl, bannerHref, isPublic, cashPrize, sponsor, sponsorReferralUrl, sponsorName, sponsorLogoUrl, hostLogoUrl, promoTitle, promoSubtitle, promoHref, promoCta, promoOffer1, promoCode1, promoOffer2, promoCode2, seasonId } = body;
  try {
    const patch: Record<string, unknown> = {};
    if (title !== undefined) patch.title = String(title);
    if (code !== undefined) patch.code = String(code);
    if (executionMode !== undefined) patch.executionMode = executionMode === 'real' ? 'real' : 'paper';
    if (startAt !== undefined) patch.startAt = Number(startAt);
    if (endAt !== undefined) patch.endAt = Number(endAt);
    if (registrationEndsAt !== undefined) {
      patch.registrationEndsAt = registrationEndsAt == null || registrationEndsAt === ''
        ? null
        : Number(registrationEndsAt);
    }
    if ('dailyDrawdownPercent' in body) patch.dailyDrawdownPercent = dailyDrawdownPercent;
    if ('bannerImageUrl' in body) patch.bannerImageUrl = bannerImageUrl;
    if ('bannerHref' in body) patch.bannerHref = bannerHref;
    if (isPublic !== undefined) patch.isPublic = Boolean(isPublic);
    if ('cashPrize' in body) patch.cashPrize = cashPrize;
    if ('sponsor' in body) patch.sponsor = sponsor;
    if ('sponsorReferralUrl' in body) patch.sponsorReferralUrl = sponsorReferralUrl;
    if ('sponsorName' in body) patch.sponsorName = sponsorName;
    if ('sponsorLogoUrl' in body) patch.sponsorLogoUrl = sponsorLogoUrl;
    if ('hostLogoUrl' in body) patch.hostLogoUrl = hostLogoUrl;
    if ('promoTitle' in body) patch.promoTitle = promoTitle;
    if ('promoSubtitle' in body) patch.promoSubtitle = promoSubtitle;
    if ('promoHref' in body) patch.promoHref = promoHref;
    if ('promoCta' in body) patch.promoCta = promoCta;
    if ('promoOffer1' in body) patch.promoOffer1 = promoOffer1;
    if ('promoCode1' in body) patch.promoCode1 = promoCode1;
    if ('promoOffer2' in body) patch.promoOffer2 = promoOffer2;
    if ('promoCode2' in body) patch.promoCode2 = promoCode2;
    if ('seasonId' in body) patch.seasonId = seasonId;

    const competition = competitionManager.updateCompetition(String(req.params.id || ''), patch);
    await competitionManager.persist();
    void syncLiveMarketFeeds();
    res.json({ ok: true, competition });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Mise a jour competition impossible' });
  }
});

app.delete('/api/admin/competitions/:id/participants', requireAdmin, async (req, res) => {
  try {
    const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds.map(String) : [];
    const reason = String(req.body?.reason || 'Admin removal').trim();
    const result = await competitionManager.removeCompetitionParticipants(
      String(req.params.id || ''),
      userIds,
      reason,
    );
    const paperPlayerIds = result.removed
      .map((entry) => entry.paperPlayerId)
      .filter((value): value is string => Boolean(value));

    manager.unmarkOnlineCompetitionPlayers(paperPlayerIds);
    for (const playerId of paperPlayerIds) {
      await competitionManager.deleteTraderSessionsForPlayer(playerId);
      await manager.removePlayerPermanently(playerId);
    }

    res.json({ ok: true, removed: result.removed });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Suppression participants impossible' });
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

// --- Payouts (certificats de gains) ---------------------------------------

app.get('/api/admin/payout-users', requireAdmin, async (req, res) => {
  if (IS_SERVERLESS) await competitionManager.refresh();
  const q = String(req.query.q || '');
  res.json({ users: competitionManager.searchUsers(q) });
});

app.get('/api/admin/payouts', requireAdmin, async (_req, res) => {
  if (IS_SERVERLESS) await competitionManager.refresh();
  res.json({ payouts: competitionManager.listAllPayouts() });
});

app.post('/api/admin/payouts', requireAdmin, async (req, res) => {
  const { userId, amount, currency, paidAt } = req.body || {};
  try {
    const payout = competitionManager.createPayout({
      userId: String(userId || ''),
      amount: Number(amount),
      currency: currency ? String(currency) : undefined,
      paidAt: paidAt == null || paidAt === '' ? undefined : Number(paidAt),
    });
    await competitionManager.persist();
    notifyPayoutAvailable(payout);
    res.json({ ok: true, payout });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Creation payout impossible' });
  }
});

app.delete('/api/admin/payouts/:id', requireAdmin, async (req, res) => {
  try {
    const ok = competitionManager.deletePayout(String(req.params.id || ''));
    if (!ok) {
      res.status(404).json({ error: 'Payout introuvable' });
      return;
    }
    await competitionManager.persist();
    res.json({ ok: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Suppression payout impossible' });
  }
});

function payoutRankLabel(rank?: number | null): string {
  const r = Number(rank);
  if (r === 1) return '1er';
  if (r === 2) return '2e';
  if (r === 3) return '3e';
  if (Number.isFinite(r) && r > 0) return `#${r}`;
  return '—';
}

function notifyPayoutAvailable(payout: { id?: string; userId: string; amount: number; currency: string; competitionId?: string | null }): void {
  const amountLabel = payoutAmountLabel(payout.amount, payout.currency);
  void sendPushToUser(payout.userId, {
    title: 'Payout à réclamer',
    body: `${amountLabel} t’attendent. Ouvre l’app pour claim tes gains.`,
    kind: 'payout',
    competitionId: payout.competitionId || undefined,
    data: { payoutId: payout.id || undefined },
  }).catch((error) => {
    console.warn('[payout] push failed:', (error as Error)?.message || error);
  });
}

function payoutAmountLabel(amount: number, currency: string): string {
  const cur = String(currency || 'USD').toUpperCase();
  const sym = cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : '$';
  return `${sym}${Number(amount).toLocaleString('fr-FR', { maximumFractionDigits: 2 })}`;
}

app.get('/api/competition/my-payouts', async (req, res) => {
  const user = await getCompetitionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Session invalide' });
    return;
  }
  if (IS_SERVERLESS) await competitionManager.refresh();
  res.json({ payouts: competitionManager.listPayoutsForUserDetailed(user.id) });
});

app.post('/api/competition/payouts/:id/request', async (req, res) => {
  const user = await getCompetitionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Session invalide' });
    return;
  }
  const { erc20Address } = req.body || {};
  try {
    if (IS_SERVERLESS) await competitionManager.refresh();
    const payout = competitionManager.requestPayout(String(req.params.id || ''), user.id, String(erc20Address || ''));
    await competitionManager.persist();
    const detailed = competitionManager.listPayoutsForUserDetailed(user.id).find((p) => p.id === payout.id);
    const arenaTitle = detailed?.arenaTitle || 'Arène';
    const rankLabel = payoutRankLabel(payout.rank);
    const amountLabel = payoutAmountLabel(payout.amount, payout.currency);
    const emailOpts = {
      recipientName: user.name,
      arenaTitle,
      rankLabel,
      amountLabel,
      erc20Address: payout.erc20Address || undefined,
    };
    await sendPayoutRequestSubmittedEmail(user.email, emailOpts).catch((err) => {
      console.warn('[payout] submitted email failed:', err?.message || err);
    });
    await sendPayoutRequestAdminEmail(PRIZE_CONTACT_EMAIL, { ...emailOpts, userEmail: user.email }).catch((err) => {
      console.warn('[payout] admin notify email failed:', err?.message || err);
    });
    res.json({ ok: true, payout: detailed || payout });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Demande de payout impossible' });
  }
});

app.get('/api/admin/payout-requests', requireAdmin, async (_req, res) => {
  if (IS_SERVERLESS) await competitionManager.refresh();
  res.json({ requests: competitionManager.listPayoutRequests() });
});

app.patch('/api/admin/payout-requests/:id/approve', requireAdmin, async (req, res) => {
  try {
    if (IS_SERVERLESS) await competitionManager.refresh();
    const approved = competitionManager.approvePayout(String(req.params.id || ''));
    await competitionManager.persist();
    if (approved.userEmail) {
      const rankLabel = payoutRankLabel(approved.rank);
      const amountLabel = payoutAmountLabel(approved.amount, approved.currency);
      await sendPayoutApprovedEmail(approved.userEmail, {
        recipientName: approved.userName,
        arenaTitle: approved.arenaTitle || 'Arène',
        rankLabel,
        amountLabel,
        erc20Address: approved.erc20Address || undefined,
      }).catch((err) => {
        console.warn('[payout] approved email failed:', err?.message || err);
      });
    }
    res.json({ ok: true, request: approved });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Approbation impossible' });
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

app.get('/spectate/:id', async (req, res) => {
  try {
    const competitionId = String(req.params.id || '').trim();
    await syncCompetitionResultsForCompetition(competitionId);
    const data = competitionManager.getPublicLeaderboard(competitionId);
    const origin = `${req.protocol}://${req.get('host')}`;
    const publicUrl = `${origin}/spectate/${encodeURIComponent(competitionId)}`;
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(renderPublicSpectatePage({
      competition: data.competition,
      leaderboard: data.leaderboard,
      publicUrl,
      appUrl: (process.env.APP_PUBLIC_URL || 'https://btfarena.com').trim(),
    }));
  } catch {
    res.status(404).type('html').send('<!doctype html><html lang="fr"><meta name="viewport" content="width=device-width"><body style="margin:0;background:#07070a;color:#fff;font-family:Arial;display:grid;place-items:center;min-height:100vh"><main style="text-align:center"><h1>Arène introuvable</h1><p style="color:#8d8791">Cette compétition n’existe pas ou n’est plus publique.</p><a href="https://btfarena.com" style="color:#ff536b">BTF Arena</a></main></body></html>');
  }
});

// Middleware d'erreur Express global : doit être enregistré APRÈS toutes les
// routes. Capture toute erreur synchrone ou rejet propagé via next(err) afin
// de renvoyer une réponse JSON propre au lieu de laisser la connexion pendre
// (ou le process planter). Les 4 paramètres sont obligatoires pour qu'Express
// le reconnaisse comme error handler.
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[express:error]', req.method, req.path, err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(err?.status || 500).json({ error: err?.message || 'Erreur serveur interne' });
});

const serverReady = Promise.all([
  competitionManager.ready,
  manager.ready,
  itickCandles.initItickCandlesStore(),
  cryptoCandlesStore.initCryptoCandlesStore(),
]).then(async () => {
  resyncCompetitionPlayerIsolation();
  // Pousse la balance des arènes online (persistée côté compétition) dans le
  // PlayerManager pour qu'elle soit indépendante de l'événement LIVE.
  manager.setCompetitionStartingBalance(competitionManager.getCompetitionStartingBalance());
  if (isEmailTestFilterActive()) {
    const skipped = competitionManager.skipPendingHistoricalArenaNotifications();
    if (skipped > 0) {
      console.log(`[notifier] ${skipped} notification(s) d'arène historique(s) marquée(s) sans envoi (mode test filtré).`);
      await competitionManager.persist();
    }
  }
  await syncLiveMarketFeeds();
  // PnL compétition live : recalcul à chaque GET /api/competition/leaderboard/:id
  // (poll 2s). Au boot on enregistre seulement les joueurs avec positions ouvertes
  // dans le moteur paper pour SL/TP et ticks — sans mark-to-market de masse.
  manager.hydrateLiveEquityCompetitionPlayersAtBoot();
});

if (!process.env.NETLIFY) {
  serverReady.then(() => {
    server.listen(PORT, () => {
      console.log(`BTF Server running on http://localhost:${PORT}`);
      const marketTimer = setInterval(() => {
        void syncLiveMarketFeeds().catch((error) => {
          console.warn('[market] sync KO:', (error as Error).message);
        });
      }, 30_000);
      if (typeof marketTimer.unref === 'function') marketTimer.unref();
    });

    // Ferme proprement la connexion WS iTick au shutdown (tsx watch
    // reload, Ctrl-C, etc.) pour que iTick libère immédiatement la
    // session — sinon la nouvelle instance est refusée pendant ~30s.
    const gracefulShutdown = (signal: string) => {
      console.log(`[shutdown] ${signal} reçu, flush DB + fermeture iTick…`);
      try { itick.itickFeed.disconnect(); } catch { /* noop */ }
      try { manager.shutdownMarketFeed(); } catch { /* noop */ }
      void (async () => {
        try {
          await Promise.race([
            Promise.all([
              manager.flushPendingPersistence(),
              competitionManager.persist(),
            ]),
            new Promise<void>((_, reject) => {
              setTimeout(() => reject(new Error('flush timeout')), 5000);
            }),
          ]);
        } catch (err) {
          console.warn('[shutdown] flush DB:', err);
        } finally {
          process.exit(0);
        }
      })();
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

// Dernier rempart : une exception synchrone non catchée laisserait Node tuer le
// process et perdre l'état en RAM (positions/ordres non flushés). On la logue et
// on garde le process vivant — cohérent avec la politique unhandledRejection
// ci-dessus. La majorité de ces erreurs viennent de callbacks de feeds upstream
// (WS Binance/Bybit/iTick) et ne doivent pas faire tomber tout le serveur.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

export { serverReady };
export default app;
