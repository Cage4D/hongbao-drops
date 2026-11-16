// 1200×630 link-preview card (Open Graph / Telegram / X / WhatsApp unfurls).
import { paletteOf } from './theme.js';
import { decor, envelope, esc, hasCjk, wrap } from './svg.js';

export interface OgInput {
  seq: number;
  theme: string;
  status: string;
  mode: string;
  message: string | null;
  sponsor: { name: string; brandColor: string | null } | null;
  sharesLeft: number;
  sharesTotal: number;
  remainingUsd: number | null;
  remainingSats: number;
}

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export function ogSvg(i: OgInput): { svg: string; cjk: boolean } {
  const p = paletteOf(i.theme);
  const font = `Inter, 'Noto Sans SC'`;
  const message =
    i.message?.trim() || (i.sponsor ? `${i.sponsor.name} sent you a red envelope` : 'A red envelope of BCH for you!');
  const lines = wrap(message, 10.8, 3);
  const msgSize = lines.length === 3 ? 52 : 58;
  const msgTop = 230;
  const amount = i.remainingUsd !== null ? `$${i.remainingUsd.toFixed(2)}` : `${i.remainingSats.toLocaleString('en-US')} sats`;
  const stats =
    i.status === 'PENDING_FUNDING' ? `${i.sharesTotal} shares · ${amount}` : `${i.sharesLeft} of ${i.sharesTotal} left · ${amount}`;
  const chip =
    i.status === 'ACTIVE'
      ? i.mode === 'QUIZ'
        ? 'Answer to open →'
        : 'Tap to open →'
      : i.status === 'EXHAUSTED'
        ? 'All grabbed!'
        : i.status === 'PENDING_FUNDING'
          ? 'Opening soon'
          : 'Expired';
  const brandColor = i.sponsor?.brandColor && /^#[0-9a-fA-F]{6}$/.test(i.sponsor.brandColor) ? i.sponsor.brandColor : null;
  const chipBg = brandColor ?? p.chipBg;
  const chipW = 60 + chip.length * 17;
  const label = i.sponsor
    ? `SPONSORED BY ${i.sponsor.name.toUpperCase()}`
    : i.mode === 'LUCKY'
      ? 'LUCKY RED ENVELOPE'
      : i.mode === 'QUIZ'
        ? 'QUIZ RED ENVELOPE'
        : 'RED ENVELOPE';
  const messageText = lines
    .map(
      (l, k) =>
        `<text x="490" y="${msgTop + k * (msgSize + 12)}" font-family="${font}" font-weight="800" font-size="${msgSize}" fill="${p.text}">${esc(l)}</text>`,
    )
    .join('\n  ');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <defs>
    <radialGradient id="bg" cx="0.3" cy="0.4" r="0.9"><stop offset="0" stop-color="${p.bgFrom}"/><stop offset="1" stop-color="${p.bgTo}"/></radialGradient>
  </defs>
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#bg)"/>
  <g>${decor(p, OG_WIDTH, OG_HEIGHT, i.seq * 7919)}</g>
  ${envelope(p, 120, 110, 280)}
  <text x="490" y="170" font-family="${font}" font-weight="800" font-size="26" letter-spacing="4" fill="${p.subtext}">${esc(label.slice(0, 44))}</text>
  ${messageText}
  <text x="490" y="490" font-family="${font}" font-weight="800" font-size="48" fill="${p.accent}">${esc(stats)}</text>
  <rect x="490" y="520" width="${chipW}" height="64" rx="32" fill="${chipBg}"/>
  <text x="${490 + chipW / 2}" y="562" font-family="${font}" font-weight="800" font-size="30" fill="${brandColor ? '#FFFFFF' : p.chipText}" text-anchor="middle">${esc(chip)}</text>
  <text x="${OG_WIDTH - 40}" y="${OG_HEIGHT - 30}" font-family="${font}" font-weight="700" font-size="22" fill="${p.subtext}" text-anchor="end" opacity="0.85">hongbao · Bitcoin Cash</text>
</svg>`;
  return { svg, cjk: hasCjk(message) || hasCjk(label) };
}

export function ogAlt(i: OgInput): string {
  const p = paletteOf(i.theme);
  const who = i.sponsor ? ` from ${i.sponsor.name}` : '';
  const left = i.status === 'ACTIVE' ? `, ${i.sharesLeft} of ${i.sharesTotal} shares left` : '';
  return `A ${p.label} red envelope${who}${i.message ? `: "${i.message.slice(0, 120)}"` : ''}${left}`;
}
