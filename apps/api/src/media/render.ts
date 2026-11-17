// SVG → PNG with resvg. Fonts are bundled (Vercel functions have no system fonts): Inter for Latin,
// Noto Sans SC only when the text contains CJK (~10 MB; red envelopes often carry Chinese greetings).
//
// The fonts are embedded as base64 modules by tools/embed-fonts.mjs (Vercel's zero-config NestJS
// build can't `includeFiles`). This resvg version only reads font *files*, so each font is written
// once per instance to the OS temp dir.
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const fontPaths = new Map<string, Promise<string>>();

function fontFile(name: string, load: () => Promise<string>): Promise<string> {
  if (!fontPaths.has(name)) {
    fontPaths.set(
      name,
      load().then((b64) => {
        const path = join(tmpdir(), `hongbao-${name}.ttf`);
        if (!existsSync(path)) writeFileSync(path, Buffer.from(b64, 'base64'));
        return path;
      }),
    );
  }
  return fontPaths.get(name)!;
}

const inter = () => import('../generated/fonts/inter.js');
const notoSc = () => import('../generated/fonts/noto-sans-sc.js');

export async function renderPng(svg: string, width: number, withCjk = false): Promise<Buffer> {
  const fontFiles = await Promise.all([
    fontFile('inter-700', async () => (await inter()).INTER_BOLD),
    fontFile('inter-800', async () => (await inter()).INTER_EXTRABOLD),
    ...(withCjk ? [fontFile('noto-sc-700', async () => (await notoSc()).NOTO_SC_BOLD)] : []),
  ]);
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Inter' },
  });
  return r.render().asPng();
}
