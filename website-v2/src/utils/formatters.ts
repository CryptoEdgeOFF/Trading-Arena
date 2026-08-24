export function formatUSD(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(2);
}

export function formatPnl(value: number): string {
  const prefix = value >= 0 ? '+' : '';
  return `${prefix}$${formatUSD(value)}`;
}

export function formatPercent(value: number): string {
  const prefix = value >= 0 ? '+' : '';
  return `${prefix}${value.toFixed(2)}%`;
}

export function formatPair(pair: string): string {
  return pair.replace(/^X/, '').replace(/Z(USD|EUR)$/, '/$1');
}

export function formatDHMS(ms: number, dayUnit = 'd'): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  const clock = `${pad(h)}h ${pad(m)}m ${pad(sec)}s`;
  return d > 0 ? `${d}${dayUnit} ${clock}` : clock;
}

export function formatTime(ms: number, dayUnit = 'd'): string {
  return formatDHMS(ms, dayUnit);
}

export function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return 'à l\'instant';
  if (diff < 3_600_000) return `il y a ${Math.floor(diff / 60_000)}m`;
  return `il y a ${Math.floor(diff / 3_600_000)}h`;
}
