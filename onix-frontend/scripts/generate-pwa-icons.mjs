/**
 * Regenerate PWA icons from public/brand/onix-mark.png
 * Black square (#000000) + centered mark — matches source framing.
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

const BG = { r: 0, g: 0, b: 0, alpha: 1 };

async function makeIcon(size, logoRatio, fileName) {
  const logoSize = Math.round(size * logoRatio);
  const logo = await sharp(src)
    .resize(logoSize, logoSize, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  const left = Math.round((size - logoSize) / 2);
  const top = Math.round((size - logoSize) / 2);
  await sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([{ input: logo, left, top }])
    .png()
    .toFile(join(outDir, fileName));
}

await makeIcon(192, 0.8, 'icon-192.png');
await makeIcon(512, 0.8, 'icon-512.png');
await makeIcon(512, 0.62, 'icon-maskable-512.png');
await makeIcon(180, 0.8, 'apple-touch-icon.png');
await makeIcon(32, 0.8, 'favicon-32.png');
console.log('[pwa-icons] wrote icons →', outDir);
