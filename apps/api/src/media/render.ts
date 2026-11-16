// SVG → PNG with resvg. Fonts are bundled (Vercel functions have no system fonts): Inter for Latin,
// Noto Sans SC loaded only when the text contains CJK (it's ~10 MB; red envelopes often carry
// Chinese greetings, so it matters). Phase 8 note: include these .ttf files in the function bundle.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const require = createRequire(import.meta.url);
const pkgDir = (name: string) => dirname(require.resolve(`${name}/package.json`));

export const FONT_FILES = {
  interBold: join(pkgDir('@expo-google-fonts/inter'), '700Bold', 'Inter_700Bold.ttf'),
  interExtraBold: join(pkgDir('@expo-google-fonts/inter'), '800ExtraBold', 'Inter_800ExtraBold.ttf'),
  notoScBold: join(pkgDir('@expo-google-fonts/noto-sans-sc'), '700Bold', 'NotoSansSC_700Bold.ttf'),
};

export function renderPng(svg: string, width: number, withCjk = false): Buffer {
  const fontFiles = [FONT_FILES.interBold, FONT_FILES.interExtraBold];
  if (withCjk) fontFiles.push(FONT_FILES.notoScBold);
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Inter' },
  });
  return r.render().asPng();
}
