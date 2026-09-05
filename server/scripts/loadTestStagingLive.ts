import 'dotenv/config';
import WebSocket from 'ws';

const base = (process.env.STAGING_API_URL || 'https://btf-mobile-staging-production.up.railway.app').replace(/\/+$/, '');
const wsBase = base.replace(/^http/, 'ws');
const paperSocketCount = Math.max(1, Number(process.argv[2]) || 100);
const spectatorSocketCount = Math.max(0, Number(process.argv[3]) || 25);
const durationSeconds = Math.max(20, Number(process.argv[4]) || 90);

type RuntimeMetrics = {
  memory: { rss: number; heapUsed: number };
  sockets: { total: number; global: number; paper: number; arena: number };
};

async function api(path: string, init?: RequestInit): Promise<any> {
  const startedAt = performance.now();
  const response = await fetch(`${base}${path}`, {
    ...init,
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}: ${payload.error || response.status}`);
  return { payload, latencyMs: performance.now() - startedAt };
}

function percentile(values: number[], ratio: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

async function main() {
  const login = await api('/api/competition/auth/test-login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'ARTEMTEST987' }),
  });
  const competitionId = login.payload.testCompetitionId;
  const userToken = login.payload.token;
  const tradeSession = await api('/api/competition/trade/session', {
    method: 'POST',
    headers: { authorization: `Bearer ${userToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ competitionId }),
  });
  const paperToken = tradeSession.payload.token;
  const before = (await api('/api/staging/runtime-metrics')).payload as RuntimeMetrics;

  const sockets: WebSocket[] = [];
  const messageCounts: Record<string, number> = {};
  let receivedBytes = 0;
  let unexpectedCloses = 0;
  let cleaningUp = false;

  const connect = (url: string) => new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url);
    sockets.push(socket);
    const timeout = setTimeout(() => reject(new Error(`WebSocket timeout: ${url}`)), 30_000);
    socket.on('open', () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.on('message', (raw) => {
      receivedBytes += raw.byteLength;
      try {
        const type = JSON.parse(raw.toString()).type || 'unknown';
        messageCounts[type] = (messageCounts[type] || 0) + 1;
      } catch {
        messageCounts.invalid = (messageCounts.invalid || 0) + 1;
      }
    });
    socket.on('close', () => {
      if (!cleaningUp) unexpectedCloses += 1;
    });
    socket.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });

  await Promise.all([
    ...Array.from({ length: paperSocketCount }, () => (
      connect(`${wsBase}/ws?paperToken=${encodeURIComponent(paperToken)}`)
    )),
    ...Array.from({ length: spectatorSocketCount }, () => (
      connect(`${wsBase}/ws?arenaId=${encodeURIComponent(competitionId)}`)
    )),
  ]);

  // Laisse arriver les snapshots initiaux avant les mutations.
  await new Promise((resolve) => setTimeout(resolve, 3_000));

  const paperState = (await api('/api/paper/me', {
    headers: { authorization: `Bearer ${paperToken}` },
  })).payload;
  const mark = Number(paperState.market?.['BTC/USD']?.markPrice);
  if (!Number.isFinite(mark) || mark <= 0) throw new Error('Prix BTC indisponible');

  // Des cycles réels ouvrent puis ferment une position avec SL/TP attachés.
  for (let index = 0; index < 8; index += 1) {
    await api('/api/paper/order', {
      method: 'POST',
      headers: { authorization: `Bearer ${paperToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        pair: 'BTC/USD',
        side: index % 2 === 0 ? 'long' : 'short',
        size: 0.001,
        orderType: 'market',
        leverage: 5,
        stopLoss: index % 2 === 0 ? mark * 0.98 : mark * 1.02,
        takeProfit: index % 2 === 0 ? mark * 1.02 : mark * 0.98,
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 350));
    const current = (await api('/api/paper/me', {
      headers: { authorization: `Bearer ${paperToken}` },
    })).payload;
    const position = current.player?.openPositions?.find((item: any) => item.pair === 'BTC/USD');
    if (position) {
      await api('/api/paper/close', {
        method: 'POST',
        headers: { authorization: `Bearer ${paperToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ positionId: position.id }),
      });
    }
  }

  const latencies: number[] = [];
  const runtimeSamples: RuntimeMetrics[] = [];
  let httpErrors = 0;
  const deadline = Date.now() + durationSeconds * 1_000;
  let nextMetricsAt = 0;
  while (Date.now() < deadline) {
    try {
      const health = await api('/api/health');
      latencies.push(health.latencyMs);
      if (Date.now() >= nextMetricsAt) {
        runtimeSamples.push((await api('/api/staging/runtime-metrics')).payload);
        nextMetricsAt = Date.now() + 5_000;
      }
    } catch {
      httpErrors += 1;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  const after = (await api('/api/staging/runtime-metrics')).payload as RuntimeMetrics;
  cleaningUp = true;
  for (const socket of sockets) socket.close();

  const maxRss = Math.max(before.memory.rss, after.memory.rss, ...runtimeSamples.map((sample) => sample.memory.rss));
  const summary = {
    competitionId,
    requestedSockets: paperSocketCount + spectatorSocketCount,
    serverSocketsAtPeak: Math.max(...runtimeSamples.map((sample) => sample.sockets.total), after.sockets.total),
    paperSockets: paperSocketCount,
    spectatorSockets: spectatorSocketCount,
    durationSeconds,
    unexpectedCloses,
    httpErrors,
    latencyMs: {
      p50: Number(percentile(latencies, 0.5).toFixed(1)),
      p95: Number(percentile(latencies, 0.95).toFixed(1)),
      max: Number(Math.max(...latencies).toFixed(1)),
    },
    memoryMb: {
      beforeRss: Number((before.memory.rss / 1024 / 1024).toFixed(1)),
      peakRss: Number((maxRss / 1024 / 1024).toFixed(1)),
      afterRss: Number((after.memory.rss / 1024 / 1024).toFixed(1)),
      growth: Number(((after.memory.rss - before.memory.rss) / 1024 / 1024).toFixed(1)),
    },
    websocket: {
      receivedMb: Number((receivedBytes / 1024 / 1024).toFixed(2)),
      messageCounts,
    },
  };
  console.log(JSON.stringify(summary, null, 2));

  if (unexpectedCloses > 0 || httpErrors > 0 || summary.latencyMs.p95 > 1_000 || summary.memoryMb.growth > 300) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
