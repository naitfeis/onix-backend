/**
 * Regenerate PWA icons from public/brand/onix-mark.png
 * Transparent square canvases — no solid background plate.
 * Mark is centered (contain): ~85% of canvas for standard icons,
 * ~62% for maskable safe-zone.
 *
 * Usage: node scripts/generate-pwa-icons.mjs
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'public', 'brand', 'onix-mark.png');
const outDir = join(root, 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

async function makeIcon(size, logoRatio, fileName) {
  const logoSize = Math.round(size * logoRatio);
  const logo = await sharp(src)
    .resize(logoSize, logoSize, {
      fit: 'contain',
      background: TRANSPARENT,
    })
    .ensureAlpha()
    .png()
    .toBuffer();

  const meta = await sharp(logo).metadata();
  const lw = meta.width ?? logoSize;
  const lh = meta.height ?? logoSize;
  const left = Math.round((size - lw) / 2);
  const top = Math.round((size - lh) / 2);

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: TRANSPARENT,
    },
  })
    .composite([{ input: logo, left, top }])
    .png()
    .toFile(join(outDir, fileName));
}

await makeIcon(192, 0.85, 'icon-192.png');
await makeIcon(512, 0.85, 'icon-512.png');
await makeIcon(512, 0.62, 'icon-maskable-512.png');
await makeIcon(180, 0.85, 'apple-touch-icon.png');
await makeIcon(32, 0.85, 'favicon-32.png');

const verifyPath = join(outDir, 'icon-512.png');
const { data, info } = await sharp(verifyPath)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const w = info.width;
const h = info.height;
const corner = (x, y) => {
  const i = (y * w + x) * 4;
  return `rgba(${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]})`;
};
console.log('[pwa-icons] wrote icons →', outDir);
console.log(
  '[pwa-icons] icon-512 corners',
  corner(0, 0),
  corner(w - 1, 0),
  corner(0, h - 1),
  corner(w - 1, h - 1),
);
