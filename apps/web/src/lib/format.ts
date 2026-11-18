export const SATS_PER_BCH = 100_000_000;

export function fmtBch(sats: number | bigint, digits = 8): string {
  const n = Number(sats) / SATS_PER_BCH;
  return n.toFixed(digits).replace(/\.?0+$/, '') || '0';
}

export function fmtSats(sats: number | bigint): string {
  return Number(sats).toLocaleString('en-US');
}

export function fmtUsd(usd: number | null | undefined): string {
  if (usd == null) return '';
  if (usd > 0 && usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

export const satsToUsd = (sats: number, price: number | null) => (price == null ? null : (sats / SATS_PER_BCH) * price);
export const usdToSats = (usd: number, price: number) => Math.round((usd / price) * SATS_PER_BCH);

export function fmtDuration(sec: number): string {
  if (sec <= 0) return '0s';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function shortAddr(a: string): string {
  const body = a.includes(':') ? a.split(':')[1]! : a;
  return body.length > 16 ? `${body.slice(0, 8)}…${body.slice(-6)}` : body;
}
