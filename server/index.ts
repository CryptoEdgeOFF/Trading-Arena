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
import { GameState, EventConfig } from './types.js';
import * as kraken from './kraken.js';
import * as hyperliquid from './hyperliquid.js';
import { CompetitionManager } from './competitionManager.js';
import { sendOtpEmail } from './mailer.js';
import { checkSmsOtp, isSmsLive, sendSmsOtp } from './smsSender.js';
import { getMarketMetadata } from './marketMetadata.js';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const PORT = 3001;

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

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOADS_DIR));
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

// --- Admin auth (single shared code, configurable via env) ---
const ADMIN_CODE = (process.env.ADMIN_CODE || 'BTFb9Q6z69.9').trim();
const adminTokens = new Set<string>();

function getAdminToken(req: express.Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length);
  const direct = req.headers['x-admin-token'];
  if (typeof direct === 'string' && direct) return direct;
  return null;
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const token = getAdminToken(req);
  if (!token || !adminTokens.has(token)) {
    res.status(401).json({ error: 'Acces admin requis' });
    return;
  }
  next();
}
const manager = new PlayerManager((state: GameState) => {
  const msg = JSON.stringify({ type: 'state', data: state });
  clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
});

function syncCompetitionResultForPlayer(playerId: string): void {
  const player = manager.getPlayerById(playerId);
  if (!player) return;
  competitionManager.updatePaperResultByPlayerId(player.id, {
    pnlUsd: player.pnl,
    pnlPercent: player.pnlPercent,
    tradesCount: player.tradeCount,
  });
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
        syncCompetitionResultForPlayer(playerId);
      }
      competitionManager.markCompetitionFinalized(competition.competitionId);
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
    syncCompetitionResultForPlayer(playerId);
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
  await finalizeEndedCompetitions();
  competitionManager.assertCompetitionTradingOpen(competitionId);
  return competitionId;
}

function getSessionToken(req: express.Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length);
}

async function getSessionPlayer(req: express.Request) {
  const token = getSessionToken(req);
  if (!token) return null;
  const info = await competitionManager.getTraderSession(token);
  if (!info) return null;
  let player = manager.getPlayerById(info.playerId);
  if (!player) {
    await manager.refresh();
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

wss.on('connection', (ws) => {
  clients.add(ws);

  const config = manager.getEventConfig();
  const initialState: GameState = {
    players: manager.getPublicPlayers() as any,
    recentTrades: [],
    market: manager.isPaperMarketActive() ? manager.getPaperMarketSnapshot() : {},
    eventStarted: manager.isStarted(),
    eventStartTime: manager.getEventStartTime(),
    eventMode: config.mode,
    teams: config.teams,
    platformMode: config.platformMode,
    paperStartingBalance: config.paperStartingBalance,
    marketDataSource: config.marketDataSource,
    newBadges: [],
    leaderChanges: [],
    spotlightTrades: [],
  };
  ws.send(JSON.stringify({ type: 'state', data: initialState }));

  ws.on('close', () => clients.delete(ws));
});

// --- Admin auth ---

app.post('/api/admin/login', (req, res) => {
  const code = String(req.body?.code || '').trim();
  if (!code || code !== ADMIN_CODE) {
    res.status(401).json({ error: 'Code admin incorrect' });
    return;
  }
  const token = crypto.randomBytes(32).toString('hex');
  adminTokens.add(token);
  res.json({ token });
});

app.get('/api/admin/check', (req, res) => {
  const token = getAdminToken(req);
  res.json({ ok: Boolean(token && adminTokens.has(token)) });
});

app.post('/api/admin/logout', (req, res) => {
  const token = getAdminToken(req);
  if (token) adminTokens.delete(token);
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

app.post('/api/roster/:id/avatar', requireAdmin, upload.single('avatar'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Fichier image requis' });
    return;
  }
  const player = manager.setAvatar(req.params.id, uploadedImageUrl(req.file));
  if (!player) {
    res.status(404).json({ error: 'Joueur introuvable' });
    return;
  }
  const { apiKey: _k, apiSecret: _s, ...publicPlayer } = player;
  res.json(publicPlayer);
});

// --- Active players (for dashboard) ---

app.get('/api/players', (_req, res) => {
  res.json(manager.getPublicPlayers());
});

// --- Event config (mode & teams) ---

app.post('/api/event/config', requireAdmin, (req, res) => {
  const { mode, teams, platformMode, paperStartingBalance, marketDataSource } = req.body as EventConfig;
  if (!mode || !['1v1', '1v1v1', '1v1v1v1', '4v4'].includes(mode)) {
    res.status(400).json({ error: 'Mode invalide' });
    return;
  }
  if (!platformMode || !['kraken', 'paper'].includes(platformMode)) {
    res.status(400).json({ error: 'Plateforme invalide' });
    return;
  }
  if (!marketDataSource || !['kraken', 'hyperliquid'].includes(marketDataSource)) {
    res.status(400).json({ error: 'Source de data invalide' });
    return;
  }
  const startingBalance = Number(paperStartingBalance);
  if (!Number.isFinite(startingBalance) || startingBalance <= 0) {
    res.status(400).json({ error: 'Balance paper invalide' });
    return;
  }

  manager.setEventConfig({
    mode,
    teams,
    platformMode,
    paperStartingBalance: startingBalance,
    marketDataSource,
  });
  res.json({ ok: true, mode, teams, platformMode, paperStartingBalance: startingBalance, marketDataSource });
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
  res.json({ ok: true, startTime: manager.getEventStartTime() });
});

app.post('/api/event/stop', requireAdmin, (_req, res) => {
  manager.stopEvent();
  res.json({ ok: true });
});

app.get('/api/event/status', (_req, res) => {
  res.json({
    started: manager.isStarted(),
    startTime: manager.getEventStartTime(),
    playerCount: manager.getActivePlayers().length,
    rosterCount: manager.getPlayers().length,
    platformMode: manager.getPlatformMode(),
    paperStartingBalance: manager.getPaperStartingBalance(),
    marketDataSource: manager.getMarketDataSource(),
  });
});

// --- Paper trading meta & auth ---

app.get('/api/paper/meta', async (_req, res) => {
  const pairs = manager.getSupportedPaperPairs();
  res.json({
    enabled: manager.getPlatformMode() === 'paper',
    eventStarted: manager.isStarted(),
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

  try {
    const source = manager.getMarketDataSource();
    const candles = source === 'hyperliquid'
      ? await hyperliquid.getOhlcCandles(pair, interval)
      : await kraken.getOhlcCandles(pair, interval);
    res.json({ pair, interval, candles });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Historique indisponible' });
  }
});

app.post('/api/paper/session', async (req, res) => {
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

  const token = crypto.randomBytes(24).toString('hex');
  await competitionManager.setTraderSession(token, player.id, null);
  const { apiKey: _k, apiSecret: _s, ...publicPlayer } = player;
  res.json({ token, player: publicPlayer });
});

app.get('/api/paper/me', async (req, res) => {
  const token = getSessionToken(req);
  const player = await getSessionPlayer(req);
  if (!player) {
    res.status(401).json({ error: 'Session invalide' });
    return;
  }

  const { apiKey: _k, apiSecret: _s, ...publicPlayer } = player;
  const competitionId = token ? ((await competitionManager.getTraderSession(token))?.competitionId || null) : null;
  const isCompetition = Boolean(competitionId);

  let competitionPayload: unknown = null;
  if (competitionId) {
    await finalizeEndedCompetitions();
    syncCompetitionResultForPlayer(player.id);
    const ctx = competitionManager.getCompetitionContextForPaperPlayer(competitionId, player.id);
    competitionPayload = ctx || { id: competitionId };
  }
  const competitionStatus = competitionId ? competitionManager.getCompetitionStatus(competitionId) : null;

  res.json({
    player: publicPlayer,
    market: manager.isPaperMarketActive() ? manager.getPaperMarketSnapshot() : {},
    fees: manager.getPaperFeeRates(),
    pairs: manager.getSupportedPaperPairs(),
    startingBalance: manager.getPaperStartingBalance(),
    marketDataSource: manager.getMarketDataSource(),
    eventStarted: manager.isStarted(),
    canTrade: isCompetition ? competitionStatus === 'live' : manager.isStarted(),
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
    if (competitionId) syncCompetitionResultForPlayer(player.id);
    res.json({ ok: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Ordre refusé' });
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
    const handler = competitionId
      ? manager.cancelCompetitionPaperOrder.bind(manager)
      : async (playerId: string, orderId: string) => manager.cancelPaperOrder(playerId, orderId);
    await handler(player.id, String(req.body?.orderId || ''));
    if (competitionId) syncCompetitionResultForPlayer(player.id);
    res.json({ ok: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Annulation refusée' });
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
    const handler = competitionId
      ? manager.closeCompetitionPaperPosition.bind(manager)
      : manager.closePaperPosition.bind(manager);
    const rawSize = req.body?.size;
    const rawPercent = req.body?.percent;
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
      const positionRef = String(req.body?.positionId || req.body?.pair || '');
      const playerForSize = manager.getPlayerById(player.id);
      const position = playerForSize?.openPositions.find((entry) => entry.id === positionRef)
        ?? playerForSize?.openPositions.find((entry) => entry.pair === positionRef);
      if (position) partialSize = position.size * (pct / 100);
    }
    await handler(player.id, String(req.body?.positionId || req.body?.pair || ''), partialSize);
    if (competitionId) syncCompetitionResultForPlayer(player.id);
    res.json({ ok: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Clôture refusée' });
  }
});

app.post('/api/paper/risk', async (req, res) => {
  const token = getSessionToken(req);
  const player = await getSessionPlayer(req);
  if (!player) {
    res.status(401).json({ error: 'Session invalide' });
    return;
  }

  const { pair, positionId, stopLoss, takeProfit, stopLossSize, takeProfitSize } = req.body || {};
  try {
    const competitionId = await assertCompetitionTraderCanTrade(token);
    const isCompetition = Boolean(competitionId);
    const options = {
      stopLossSize: stopLossSize == null || stopLossSize === '' ? null : Number(stopLossSize),
      takeProfitSize: takeProfitSize == null || takeProfitSize === '' ? null : Number(takeProfitSize),
    };
    const sl = stopLoss == null ? null : Number(stopLoss);
    const tp = takeProfit == null ? null : Number(takeProfit);
    const positionRef = String(positionId || pair || '');
    if (isCompetition) {
      await manager.updateCompetitionPaperPositionRisk(player.id, positionRef, sl, tp, options);
      syncCompetitionResultForPlayer(player.id);
    } else {
      manager.updatePaperPositionRisk(player.id, positionRef, sl, tp, options);
    }
    res.json({ ok: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Modification SL/TP refusée' });
  }
});

// --- Competition platform: auth, join, public leaderboard ---

app.post('/api/competition/auth/request', async (req, res) => {
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
      // Surface the OTP in the response when no mailer is configured (dev mode)
      // OR when the configured mailer rejected the send (e.g. Resend trial limit).
      // This avoids being stuck on a "Mode dev" screen with no actual code visible.
      devCode: !result.delivered ? code : undefined,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Demande OTP impossible' });
  }
});

app.post('/api/competition/auth/verify', async (req, res) => {
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
      // Code SMS expose seulement quand Twilio n'est pas configure (mode dev).
      // Twilio Verify gere son propre code, on ignore localCode dans ce cas.
      devSmsCode: !isSmsLive() ? phoneInfo.localCode : undefined,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Verification impossible' });
  }
});

app.post('/api/competition/auth/verify-phone', async (req, res) => {
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

app.get('/api/competition/auth/exists', async (req, res) => {
  const email = String(req.query.email || '').trim();
  if (!email) {
    res.status(400).json({ error: 'email requis' });
    return;
  }
  await competitionManager.refresh();
  res.json({ exists: competitionManager.emailExists(email) });
});

app.get('/api/competition/me', async (req, res) => {
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
    const nextUser = competitionManager.setUserAvatar(user.id, uploadedImageUrl(req.file));
    res.json({ user: nextUser });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Avatar impossible a modifier' });
  }
});

app.get('/api/competition/public', async (_req, res) => {
  await syncAllCompetitionResults();
  res.json({ competitions: competitionManager.listPublicCompetitions() });
});

app.get('/api/competition/mine', async (req, res) => {
  const user = await getCompetitionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Session invalide' });
    return;
  }
  await syncAllCompetitionResults();
  res.json({ competitions: competitionManager.listUserCompetitions(user.id) });
});

app.post('/api/competition/join', async (req, res) => {
  const user = await getCompetitionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Session invalide' });
    return;
  }
  try {
    const competition = competitionManager.joinCompetition(user.id, String(req.body?.code || ''));
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
    await finalizeEndedCompetitions();
    const { competition, entry } = competitionManager.getCompetitionForUser(competitionId, user.id);
    competitionManager.assertCompetitionTradingOpen(competition.id);
    if (competition.executionMode === 'real') {
      res.status(400).json({ error: 'Le mode reel de la competition n est pas encore disponible dans ce terminal' });
      return;
    }
    let player = entry.paperPlayerId ? manager.getPlayerById(entry.paperPlayerId) : null;

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
    // setTraderSession ecrit DIRECTEMENT dans la table comp_trader_sessions
    // (une ligne par token), donc on ne risque pas d'etre ecrase par un
    // autre Lambda qui ecrirait le blob global au meme moment.
    await competitionManager.setTraderSession(token, player.id, competition.id);
    syncCompetitionResultForPlayer(player.id);

    // Le roster paper utilise toujours un blob, on le persiste pour que
    // l'instance suivante puisse retrouver le player.
    await manager.persist();

    const { apiKey: _k, apiSecret: _s, ...publicPlayer } = player;

    res.json({
      token,
      player: publicPlayer,
      competition: { id: competition.id, title: competition.title, executionMode: competition.executionMode },
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

app.get('/api/admin/competitions', requireAdmin, async (_req, res) => {
  await syncAllCompetitionResults();
  res.json({ competitions: competitionManager.listAdminCompetitions() });
});

app.post('/api/admin/competitions', requireAdmin, (req, res) => {
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
    res.json({ ok: true, competition });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Creation competition impossible' });
  }
});

app.patch('/api/admin/competitions/:id', requireAdmin, (req, res) => {
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
    res.json({ ok: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Suppression competition impossible' });
  }
});

app.post('/api/admin/competitions/result', requireAdmin, (req, res) => {
  const { competitionId, userId, pnlUsd, pnlPercent, tradesCount } = req.body || {};
  try {
    competitionManager.upsertResult({
      competitionId: String(competitionId || ''),
      userId: String(userId || ''),
      pnlUsd: Number(pnlUsd),
      pnlPercent: Number(pnlPercent),
      tradesCount: Number(tradesCount),
    });
    res.json({ ok: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Mise a jour resultat impossible' });
  }
});

const serverReady = Promise.all([competitionManager.ready, manager.ready]).then(() => {
  manager.markOnlineCompetitionPlayers(competitionManager.getPaperPlayerIds());
});

if (!process.env.NETLIFY) {
  serverReady.then(() => {
    server.listen(PORT, () => {
      console.log(`BTF Server running on http://localhost:${PORT}`);
    });
  });
}

export { serverReady };
export default app;
