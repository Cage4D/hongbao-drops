// Bakes the dragon's expensive effects into static images, so the hero animates with cheap
// compositor-only transforms/opacity instead of live CSS blur, blend modes and SVG filters.
//
//   node tools/bake-dragon.mjs            (from apps/web)
//
// Input:  tools/dragon-src.webp  (the original 1600×1101 art from the Blue Dragon design)
// Output: public/dragon.webp        base image, re-encoded (1600 px)
//         public/dragon-800.webp    the same at 800 px, for phones
//         public/dragon-bloom.webp  pre-blurred, brightened glow (was blur(10px) brightness(1.7) live)
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const src = here('./dragon-src.webp');

await sharp(src).webp({ quality: 80, alphaQuality: 80, effort: 6 }).toFile(here('../public/dragon.webp'));
// Phones (and 1× screens) get an 800 px-wide copy: the dragon is drawn at most ~600 CSS px wide there.
await sharp(src).resize(800).webp({ quality: 80, alphaQuality: 80, effort: 6 }).toFile(here('../public/dragon-800.webp'));

// Half resolution is plenty for a blur; σ is in output pixels (≈ the old 10px CSS blur at hero size).
const { data, info } = await sharp(src)
  .resize(800)
  .blur(6)
  .modulate({ brightness: 1.7, saturation: 1.2 })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
// The old layer used mix-blend-mode: screen, where dark pixels add nothing. Blend modes are slow,
// so emulate it with plain alpha: colour = c / max(c), alpha = max(c) × original alpha. Over a dark
// background that is ≈ screen(c, bg), and dark pixels become transparent instead of darkening.
for (let i = 0; i < data.length; i += 4) {
  const m = Math.max(data[i], data[i + 1], data[i + 2]);
  if (m === 0) {
    data[i + 3] = 0;
    continue;
  }
  data[i] = Math.round((data[i] * 255) / m);
  data[i + 1] = Math.round((data[i + 1] * 255) / m);
  data[i + 2] = Math.round((data[i + 2] * 255) / m);
  data[i + 3] = Math.round((m * data[i + 3]) / 255);
}
await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
  .webp({ quality: 70, alphaQuality: 70, effort: 6 })
  .toFile(here('../public/dragon-bloom.webp'));

console.log('baked public/dragon.webp and public/dragon-bloom.webp');
