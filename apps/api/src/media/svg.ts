// Small SVG helpers: escaping, rough text measurement and wrapping, shared envelope drawing.
import type { Palette } from './theme.js';

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const CJK = /[⺀-鿿가-힯豈-﫿＀-￯]/;
export const hasCjk = (s: string) => CJK.test(s);

/** Approximate rendered width in em (Inter bold ≈ 0.6 em/char, CJK = 1 em). Good enough for wrapping. */
export function widthEm(s: string): number {
  let w = 0;
  for (const ch of s) w += CJK.test(ch) ? 1 : /[MW@]/.test(ch) ? 0.85 : /[ilj.,'!|]/.test(ch) ? 0.3 : ch === ' ' ? 0.28 : 0.6;
  return w;
}

/** Greedy wrap to `maxEm` per line, at most `maxLines` lines, ellipsis on overflow. CJK breaks anywhere. */
export function wrap(text: string, maxEm: number, maxLines: number): string[] {
  const tokens = text.trim().replace(/\s+/g, ' ').match(/[⺀-鿿가-힯豈-﫿＀-￯]|[^\s⺀-鿿가-힯豈-﫿＀-￯]+|\s/g) ?? [];
  const lines: string[] = [];
  let line = '';
  for (const tok of tokens) {
    const next = line + tok;
    if (widthEm(next.trim()) <= maxEm || line === '') {
      line = next;
      continue;
    }
    lines.push(line.trim());
    line = tok.trim();
  }
  if (line.trim()) lines.push(line.trim());
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1]!;
  while (widthEm(last + '…') > maxEm && last.length > 1) last = [...last].slice(0, -1).join('');
  kept[maxLines - 1] = last.trimEnd() + '…';
  return kept;
}

/** A red envelope (hongbao) drawn at (x, y) with width w; height is 1.45 w. */
export function envelope(p: Palette, x: number, y: number, w: number, sealText = 'BCH'): string {
  const h = w * 1.45;
  const r = w * 0.08;
  const flapH = h * 0.42;
  const sealR = w * 0.17;
  const cx = x + w / 2;
  const sealY = y + flapH;
  return `
  <g>
    <rect x="${x + w * 0.04}" y="${y + w * 0.06}" width="${w}" height="${h}" rx="${r}" fill="#000" opacity="0.22"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${p.envelope}"/>
    <path d="M ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${y + flapH * 0.55} Q ${cx} ${y + flapH * 1.35} ${x} ${y + flapH * 0.55} Z" fill="${p.flap}"/>
    <rect x="${x + w * 0.08}" y="${y + h * 0.66}" width="${w * 0.84}" height="${h * 0.012}" fill="${p.seal}" opacity="0.6"/>
    <rect x="${x + w * 0.08}" y="${y + h * 0.9}" width="${w * 0.84}" height="${h * 0.012}" fill="${p.seal}" opacity="0.6"/>
    <circle cx="${cx}" cy="${sealY}" r="${sealR * 1.12}" fill="${p.envelopeShade}" opacity="0.5"/>
    <circle cx="${cx}" cy="${sealY}" r="${sealR}" fill="${p.seal}"/>
    <circle cx="${cx}" cy="${sealY}" r="${sealR * 0.82}" fill="none" stroke="${p.sealText}" stroke-width="${w * 0.012}" opacity="0.5"/>
    <text x="${cx}" y="${sealY + sealR * 0.22}" font-family="Inter" font-weight="800" font-size="${sealR * 0.6}" fill="${p.sealText}" text-anchor="middle">${esc(sealText)}</text>
  </g>`;
}

/** Background decoration per theme, deterministic (seeded) so images are stable. */
export function decor(p: Palette, width: number, height: number, seed: number): string {
  let s = seed || 1;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const out: string[] = [];
  const n = p.decor === 'snow' ? 40 : p.decor === 'embers' ? 22 : 14;
  for (let i = 0; i < n; i++) {
    const x = rnd() * width;
    const y = rnd() * height;
    const k = 0.5 + rnd();
    if (p.decor === 'coins') out.push(`<circle cx="${x}" cy="${y}" r="${10 * k}" fill="${p.accent}" opacity="0.13"/>`);
    if (p.decor === 'sparkle') out.push(`<path d="M ${x} ${y - 12 * k} L ${x + 3 * k} ${y - 3 * k} L ${x + 12 * k} ${y} L ${x + 3 * k} ${y + 3 * k} L ${x} ${y + 12 * k} L ${x - 3 * k} ${y + 3 * k} L ${x - 12 * k} ${y} L ${x - 3 * k} ${y - 3 * k} Z" fill="#FFFFFF" opacity="0.35"/>`);
    if (p.decor === 'embers') {
      // Rising fire sparks (the site's hero embers): a soft glow with a bright core.
      out.push(`<circle cx="${x}" cy="${y}" r="${9 * k}" fill="${p.accent}" opacity="0.12"/>
        <circle cx="${x}" cy="${y}" r="${3 * k}" fill="${p.accent}" opacity="0.55"/>
        <circle cx="${x}" cy="${y}" r="${1.4 * k}" fill="#EBFCFF" opacity="0.9"/>`);
    }
    if (p.decor === 'snow') out.push(`<circle cx="${x}" cy="${y}" r="${3.5 * k}" fill="#FFFFFF" opacity="0.55"/>`);
    if (p.decor === 'lanterns' && i < 5) {
      if (width < 600) {
        // Small canvases (stamps): keep lanterns faint so they don't fight the title.
        out.push(`<g opacity="0.35">`);
      }
      const lx = 60 + i * (width / 5);
      const ly = 0;
      out.push(`<line x1="${lx}" y1="${ly}" x2="${lx}" y2="${ly + 40}" stroke="${p.accent}" stroke-width="2" opacity="0.5"/>
        <ellipse cx="${lx}" cy="${ly + 68}" rx="26" ry="30" fill="#E53935" opacity="0.55"/>
        <rect x="${lx - 12}" y="${ly + 36}" width="24" height="6" fill="${p.accent}" opacity="0.6"/>
        <rect x="${lx - 12}" y="${ly + 94}" width="24" height="6" fill="${p.accent}" opacity="0.6"/>`);
      if (width < 600) out.push('</g>');
    }
  }
  return out.join('\n');
}
