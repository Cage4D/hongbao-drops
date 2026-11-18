// Hongbao Seal NFT artwork (one per share) and the collection icon. Square with a perforated
// edge, readable at wallet icon sizes. Deterministic: same envelope + share → same bytes.
import { paletteOf } from './theme.js';
import { decor, envelope, esc } from './svg.js';

export interface SealInput {
  theme: string;
  seq: number;
  /** 1-based share index; null for the collection icon. */
  index: number | null;
  shareCount: number;
  sponsorName?: string | null;
}

const SIZE = 512;

export function sealSvg(i: SealInput): string {
  const p = paletteOf(i.theme);
  const pad = 26;
  const holes: string[] = [];
  const step = 32;
  for (let x = step / 2; x < SIZE; x += step) {
    holes.push(`<circle cx="${x}" cy="0" r="9"/><circle cx="${x}" cy="${SIZE}" r="9"/>`);
    holes.push(`<circle cx="0" cy="${x}" r="9"/><circle cx="${SIZE}" cy="${x}" r="9"/>`);
  }
  const number = i.index === null ? `${i.shareCount} SEALS` : `#${i.seq}-${i.index}`;
  const sub = i.index === null ? `ENVELOPE #${i.seq}` : `${i.index} OF ${i.shareCount}`;
  const brand = (i.sponsorName ?? 'HONGBAO').toUpperCase().slice(0, 18);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <title>${esc(`Hongbao Seal ${number}`)}</title>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.bgFrom}"/><stop offset="1" stop-color="${p.bgTo}"/></linearGradient>
    <clipPath id="inner"><rect x="${pad}" y="${pad}" width="${SIZE - 2 * pad}" height="${SIZE - 2 * pad}" rx="10"/></clipPath>
    <mask id="perf"><rect width="${SIZE}" height="${SIZE}" fill="#fff"/><g fill="#000">${holes.join('')}</g></mask>
  </defs>
  <g mask="url(#perf)">
    <rect width="${SIZE}" height="${SIZE}" fill="#F3E3C0"/>
    <rect x="${pad}" y="${pad}" width="${SIZE - 2 * pad}" height="${SIZE - 2 * pad}" rx="10" fill="url(#bg)"/>
    <g opacity="0.9" clip-path="url(#inner)">${decor(p, SIZE, SIZE, i.seq * 131 + (i.index ?? 0))}</g>
    <rect x="${pad + 10}" y="${pad + 10}" width="${SIZE - 2 * pad - 20}" height="${SIZE - 2 * pad - 20}" rx="6" fill="none" stroke="${p.accent}" stroke-width="3" opacity="0.7"/>
    <text x="${SIZE / 2}" y="${pad + 62}" font-family="Inter" font-weight="800" font-size="34" letter-spacing="6" fill="${p.text}" text-anchor="middle">${esc(brand)}</text>
    ${envelope(p, SIZE / 2 - 82, 118, 164)}
    <text x="${SIZE / 2}" y="${SIZE - pad - 70}" font-family="Inter" font-weight="800" font-size="46" fill="${p.text}" text-anchor="middle">${esc(number)}</text>
    <text x="${SIZE / 2}" y="${SIZE - pad - 32}" font-family="Inter" font-weight="700" font-size="22" letter-spacing="3" fill="${p.subtext}" text-anchor="middle">${esc(sub)} · BCH</text>
  </g>
</svg>`;
}

export function sealAlt(i: SealInput): string {
  const p = paletteOf(i.theme);
  const who = i.sponsorName ? ` from ${i.sponsorName}` : '';
  return i.index === null
    ? `Hongbao Seal collection for envelope #${i.seq}${who}: a ${p.label} red envelope seal`
    : `Hongbao Seal #${i.seq}-${i.index}${who}: a ${p.label} red envelope seal, share ${i.index} of ${i.shareCount}`;
}
