/**
 * Restaure chakal depuis competition-backup-full-* pris avant la fermeture @ 30390.
 *
 * Usage: node scripts/restore-chakal-pre-close.mjs [chemin-backup-full.json]
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import path from 'path';

const CHAKAL_ID = '7e84868e-9334-495a-95ff-e462194c1c69';
const backupPath =
  process.argv[2]
  || 'data/backups/competition-backup-full-2026-06-02T21-49-59Z.json';

const API = process.env.RAILWAY_API_URL
  || process.env.PAPER_API_URL
  || 'https://trading-arena-api-production.up.railway.app';
const ADMIN_CODE = process.env.ADMIN_CODE || '';

if (!ADMIN_CODE) {
  console.error('ADMIN_CODE manquant dans .env');
  process.exit(1);
}

const backup = JSON.parse(readFileSync(path.resolve(backupPath), 'utf8'));
const row = backup.rawRows?.find((r) => r.id === CHAKAL_ID);
if (!row?.data) {
  console.error('chakal introuvable dans', backupPath);
  process.exit(1);
}

const snapshot = row.data;
console.log('Backup:', backupPath);
console.log('Positions:', snapshot.openPositions?.length ?? 0);
for (const p of snapshot.openPositions ?? []) {
  console.log(`  ${p.pair} ${p.side} size=${p.size} TP=${p.takeProfit} SL=${p.stopLoss}`);
}
console.log('PnL backup:', snapshot.pnl?.toFixed(2));
console.log('Closes @30390 dans backup:', (snapshot.trades ?? []).filter(
  (t) => t.action === 'close' && t.price === 30390,
).length);

const loginRes = await fetch(`${API}/api/admin/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: ADMIN_CODE }),
});
const { token } = await loginRes.json();
if (!token) {
  console.error('Login admin échoué', await loginRes.text());
  process.exit(1);
}

const restoreRes = await fetch(`${API}/api/admin/competition/restore-player-snapshot`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({ playerId: CHAKAL_ID, snapshot }),
});
const body = await restoreRes.json();
console.log('\nRéponse API:', JSON.stringify(body, null, 2));
if (!restoreRes.ok) process.exit(1);
