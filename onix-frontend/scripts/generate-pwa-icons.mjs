/**
 * PWA / shell icons — geometric ONIX X on true transparent canvases (no plate).
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

/** Standard / any: almost full-bleed figure. Maskable: safe zone for OS masks. */
const STANDARD = 0.94;
const MASKABLE = 0.7;

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

await makeIcon(192, STANDARD, join(outDir, 'onix-any-192.png'));
await makeIcon(512, STANDARD, join(outDir, 'onix-any-512.png'));
await makeIcon(512, MASKABLE, join(outDir, 'onix-maskable-512.png'));
await makeIcon(180, STANDARD, join(outDir, 'onix-apple-180.png'));
await makeIcon(32, STANDARD, join(outDir, 'onix-fav-32.png'));
await makeIcon(16, STANDARD, join(outDir, 'onix-fav-16.png'));

// Legacy filenames for old links / cached manifests
copyFileSync(join(outDir, 'onix-any-192.png'), join(outDir, 'icon-192.png'));
copyFileSync(join(outDir, 'onix-any-512.png'), join(outDir, 'icon-512.png'));
copyFileSync(join(outDir, 'onix-maskable-512.png'), join(outDir, 'icon-maskable-512.png'));
copyFileSync(join(outDir, 'onix-apple-180.png'), join(outDir, 'apple-touch-icon.png'));
copyFileSync(join(outDir, 'onix-fav-32.png'), join(outDir, 'favicon-32.png'));
copyFileSync(join(outDir, 'onix-fav-16.png'), join(outDir, 'favicon-16.png'));

const fav32 = await sharp(join(outDir, 'onix-fav-32.png')).png().toBuffer();
writeFileSync(join(publicDir, 'favicon.ico'), pngToIco(fav32));

const svgPng = fav32.toString('base64');
writeFileSync(
  join(publicDir, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">\n  <image href="data:image/png;base64,${svgPng}" width="32" height="32"/>\n</svg>\n`,
);

copyFileSync(join(outDir, 'onix-fav-32.png'), join(publicDir, 'favicon-32.png'));

function luma01(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function sat01(r, g, b) {
  const mx = Math.max(r, g, b);
  if (mx <= 0) return 0;
  return (mx - Math.min(r, g, b)) / mx;
}

async function verifyIcon(label, path) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const px = (x, y) => {
    const i = (y * w + x) * 4;
    return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
  };
  const corners = [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)];
  const ring = 8;
  let opaqueNearBlackPlate = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inRing = x < ring || y < ring || x >= w - ring || y >= h - ring;
      if (!inRing) continue;
      const p = px(x, y);
      if (p.a < 128) continue;
      const L = luma01(p.r, p.g, p.b);
      const s = sat01(p.r, p.g, p.b);
      // Near-black plate: dark + low sat (logo purple must not match)
      if (L <= 0.14 && s < 0.22) opaqueNearBlackPlate++;
    }
  }
  const okCorners = corners.every((c) => c.a === 0);
  console.log(
    `[pwa-icons] ${label} corners`,
    corners.map((c) => `rgba(${c.r},${c.g},${c.b},${c.a})`).join(' '),
  );
  console.log(`[pwa-icons] ${label} outer8px opaqueNearBlackPlate`, opaqueNearBlackPlate);
  console.log(`[pwa-icons] ${label} verifyCornersAlpha0`, okCorners);
  return okCorners && opaqueNearBlackPlate === 0;
}

console.log('[pwa-icons] wrote icons ->', outDir);
console.log('[pwa-icons] logoRatio standard', STANDARD, 'maskable', MASKABLE);
console.log('[pwa-icons] no plate — figure only on transparent canvas');

let allOk = true;
allOk = (await verifyIcon('onix-any-512', join(outDir, 'onix-any-512.png'))) && allOk;
allOk = (await verifyIcon('onix-any-192', join(outDir, 'onix-any-192.png'))) && allOk;
allOk = (await verifyIcon('onix-maskable-512', join(outDir, 'onix-maskable-512.png'))) && allOk;
if (!allOk) process.exitCode = 1;
