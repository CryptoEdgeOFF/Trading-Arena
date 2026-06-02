/**
 * Export Neon comp_paper_players → JSON backup (positions, ordres limites, SL/TP).
 *
 * Usage:
 *   node scripts/export-competition-backup.mjs
 *   node scripts/export-competition-backup.mjs --full
 *
 * Écrit dans data/backups/competition-backup-<ISO>.json (gitignored).
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';

const CONTRACT_SIZE = {
  'EUR/USD': 100_000,
  'GBP/USD': 100_000,
  'USD/JPY': 100_000,
  'USD/CHF': 100_000,
  'GOLD/USD': 100,
  'SILVER/USD': 5_000,
  'WTI/USD': 1_000,
  'BRENTOIL/USD': 1_000,
  'SP500/USD': 50,
  'NAS100/USD': 20,
  'US30/USD': 5,
};

function lotsFromEngine(pair, engineSize) {
  const cs = CONTRACT_SIZE[pair];
  if (!cs) return null;
  return engineSize / cs;
}

const fullExport = process.argv.includes('--full');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL manquant (.env)');
  process.exit(1);
}

const { default: pg } = await import('pg');
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
});

const { rows } = await pool.query(
  'select id, data from comp_paper_players order by coalesce(data->>\'name\', id)',
);
await pool.end();

const exportedAt = new Date().toISOString();
const snapshot = {
  kind: 'btf-competition-paper-backup',
  version: 1,
  exportedAt,
  fullExport,
  playerCount: rows.length,
  summary: {
    playersWithOpenPositions: 0,
    playersWithOpenLimitOrders: 0,
    totalOpenPositions: 0,
    totalOpenLimitOrders: 0,
  },
  players: [],
};

if (fullExport) {
  snapshot.rawRows = rows.map((r) => ({ id: r.id, data: r.data }));
}

for (const row of rows) {
  const p = row.data || {};
  const openPositions = (p.openPositions || []).map((pos) => ({
    id: pos.id,
    pair: pos.pair,
    side: pos.side,
    size: pos.size,
    lots: lotsFromEngine(pos.pair, pos.size),
    entryPrice: pos.entryPrice,
    markPrice: pos.markPrice,
    pnl: pos.pnl,
    leverage: pos.leverage,
    margin: pos.margin,
    feesPaid: pos.feesPaid,
    stopLoss: pos.stopLoss ?? null,
    takeProfit: pos.takeProfit ?? null,
    stopLossSize: pos.stopLossSize ?? null,
    takeProfitSize: pos.takeProfitSize ?? null,
    liquidationPrice: pos.liquidationPrice ?? null,
    openedAt: pos.openedAt ?? null,
  }));

  const openOrders = (p.openOrders || [])
    .filter((o) => o.status === 'open')
    .map((o) => ({
      id: o.id,
      pair: o.pair,
      side: o.side,
      orderType: o.orderType,
      size: o.size,
      lots: lotsFromEngine(o.pair, o.size),
      limitPrice: o.limitPrice,
      leverage: o.leverage,
      stopLoss: o.stopLoss ?? null,
      takeProfit: o.takeProfit ?? null,
      stopLossSize: o.stopLossSize ?? null,
      takeProfitSize: o.takeProfitSize ?? null,
      marginReserved: o.marginReserved,
      feeEstimate: o.feeEstimate,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    }));

  if (openPositions.length > 0) snapshot.summary.playersWithOpenPositions += 1;
  if (openOrders.length > 0) snapshot.summary.playersWithOpenLimitOrders += 1;
  snapshot.summary.totalOpenPositions += openPositions.length;
  snapshot.summary.totalOpenLimitOrders += openOrders.length;

  const hasRisk = openPositions.length > 0 || openOrders.length > 0;
  if (!hasRisk && !fullExport) continue;

  snapshot.players.push({
    id: row.id,
    name: p.name,
    traderCode: p.traderCode ?? null,
    active: p.active,
    initialBalance: p.initialBalance,
    currentBalance: p.currentBalance,
    availableMargin: p.availableMargin,
    usedMargin: p.usedMargin,
    feesPaid: p.feesPaid,
    pnl: p.pnl,
    pnlPercent: p.pnlPercent,
    tradeCount: p.tradeCount,
    lastUpdate: p.lastUpdate,
    openPositions,
    openOrders,
    trades: fullExport ? (p.trades || []) : (p.trades || []).slice(-50),
  });
}

const ts = exportedAt.replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(process.cwd(), 'data', 'backups');
mkdirSync(outDir, { recursive: true });
const suffix = fullExport ? 'full' : 'open-risk';
const outPath = path.join(outDir, `competition-backup-${suffix}-${ts}Z.json`);
writeFileSync(outPath, JSON.stringify(snapshot, null, 2));

console.log('Backup écrit:', outPath);
console.log(
  'Résumé:',
  snapshot.summary.totalOpenPositions,
  'positions,',
  snapshot.summary.totalOpenLimitOrders,
  'ordres limites,',
  snapshot.players.length,
  'joueurs exportés',
  `(total en base: ${snapshot.playerCount})`,
);
