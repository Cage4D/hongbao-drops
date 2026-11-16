// Regenerate docs/media/*.png (link-preview cards + stamps for every theme), used in the Phase 6 report.
// Usage: pnpm --filter @hongbao/api render-samples
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ogSvg } from '../src/media/og.js';
import { stampSvg } from '../src/media/stamp.js';
import { renderPng } from '../src/media/render.js';

const out = (name: string) => fileURLToPath(new URL(`../../../docs/media/${name}`, import.meta.url));
const samples = [
  { theme: 'classic-red', mode: 'EQUAL', message: 'Happy birthday Mei! First one to open gets the lucky share', sponsor: null },
  { theme: 'gold', mode: 'LUCKY', message: null, sponsor: { name: 'BCH Blaze', brandColor: '#0AC18E' } },
  { theme: 'christmas', mode: 'EQUAL', message: 'Merry Christmas from the BCH Telegram crew', sponsor: null },
  { theme: 'lunar', mode: 'EQUAL', message: '新年快乐！恭喜发财 Happy Lunar New Year', sponsor: null },
];
for (const [i, s] of samples.entries()) {
  const { svg, cjk } = ogSvg({ seq: 40 + i, theme: s.theme, status: 'ACTIVE', mode: s.mode, message: s.message, sponsor: s.sponsor, sharesLeft: 3, sharesTotal: 5, remainingUsd: 0.3, remainingSats: 145_000 });
  writeFileSync(out(`og-${s.theme}.png`), renderPng(svg, 1200, cjk));
  writeFileSync(out(`stamp-${s.theme}.png`), renderPng(stampSvg({ theme: s.theme, seq: 40 + i, index: 2, shareCount: 5, sponsorName: s.sponsor?.name ?? null }), 512));
  console.log(`rendered ${s.theme}`);
}
