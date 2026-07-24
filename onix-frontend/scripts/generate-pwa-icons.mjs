/**
 * PWA / shell icons — ALL on true transparent backgrounds (no black/gray plate).
 *
 * Usage: node scripts/generate-pwa-icons.mjs
 */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'public', 'brand', 'onix-mark.png');
const outDir = join(root, 'public', 'icons');
const publicDir = join(root, 'public');
mkdirSync(outDir, { recursive: true });

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

async function makeIcon(size, logoRatio, outPath) {
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
    .toFile(outPath);
}

/** Minimal ICO container wrapping a single PNG (Windows Vista+ / Chromium). */
function pngToIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry.writeUInt8(32, 0); // width
  entry.writeUInt8(32, 1); // height
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);

  return Buffer.concat([header, entry, png]);
}

const STANDARD = 0.88;
const MASKABLE = 0.65;

await makeIcon(192, STANDARD, join(outDir, 'icon-192.png'));
await makeIcon(512, STANDARD, join(outDir, 'icon-512.png'));
await makeIcon(512, MASKABLE, join(outDir, 'icon-maskable-512.png'));
await makeIcon(180, STANDARD, join(outDir, 'apple-touch-icon.png'));
await makeIcon(48, STANDARD, join(outDir, 'favicon-48.png'));
await makeIcon(32, STANDARD, join(outDir, 'favicon-32.png'));
await makeIcon(16, STANDARD, join(outDir, 'favicon-16.png'));

const fav32 = await sharp(join(outDir, 'favicon-32.png')).png().toBuffer();
writeFileSync(join(publicDir, 'favicon.ico'), pngToIco(fav32));

const svgPng = fav32.toString('base64');
writeFileSync(
  join(publicDir, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">\n  <image href="data:image/png;base64,${svgPng}" width="32" height="32"/>\n</svg>\n`,
);

copyFileSync(join(outDir, 'favicon-32.png'), join(publicDir, 'favicon-32.png'));

const { data, info } = await sharp(join(outDir, 'icon-512.png'))
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const w = info.width;
const h = info.height;
const px = (x, y) => {
  const i = (y * w + x) * 4;
  return `rgba(${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]})`;
};

console.log('[pwa-icons] wrote icons ->', outDir);
console.log('[pwa-icons] icon-512 corners', px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1));
const ok = [0, w - 1].every((x) =>
  [0, h - 1].every((y) => {
    const i = (y * w + x) * 4;
    return data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 0;
  }),
);
console.log('[pwa-icons] verify icon-512 corners rgba(0,0,0,0)', ok);
if (!ok) process.exitCode = 1;
