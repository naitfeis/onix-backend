/**
 * PWA / shell icons from brand mark.
 *
 * - Favicons: logo only on true transparent canvas.
 * - Manifest `any` / `maskable`: logo on a branded rounded plate with
 *   transparent pixels *outside* the squircle. Windows fills transparent
 *   icon areas with manifest `background_color`; a flat black fill looks
 *   like a broken square — the plate matches theme so the shortcut looks
 *   intentional. Pure desktop alpha without a plate is not supported by Edge.
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
/** Match vite PWA theme / Windows plate fill. */
const PLATE = { r: 0x24, g: 0x1b, b: 0x38, alpha: 1 };

const FAVICON_RATIO = 0.94;
const ANY_LOGO_RATIO = 0.72;
const MASKABLE_LOGO_RATIO = 0.62;
const SQUIRCLE_INSET = 0.06;

async function logoBuffer(size, logoRatio) {
  const logoSize = Math.round(size * logoRatio);
  return sharp(src)
    .resize(logoSize, logoSize, {
      fit: 'contain',
      background: TRANSPARENT,
    })
    .ensureAlpha()
    .png()
    .toBuffer();
}

async function makeTransparentIcon(size, logoRatio, outPath) {
  const logo = await logoBuffer(size, logoRatio);
  const meta = await sharp(logo).metadata();
  const lw = meta.width ?? Math.round(size * logoRatio);
  const lh = meta.height ?? Math.round(size * logoRatio);
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

/** Rounded square (squircle-ish via SVG) plate + centered logo; outside = alpha 0. */
async function makePlatedIcon(size, logoRatio, outPath) {
  const inset = Math.round(size * SQUIRCLE_INSET);
  const box = size - inset * 2;
  const radius = Math.round(box * 0.22);
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<rect x="${inset}" y="${inset}" width="${box}" height="${box}" rx="${radius}" ry="${radius}" ` +
      `fill="rgb(${PLATE.r},${PLATE.g},${PLATE.b})"/>` +
      `</svg>`,
  );

  const plate = await sharp(svg).ensureAlpha().png().toBuffer();
  const logo = await logoBuffer(size, logoRatio);
  const meta = await sharp(logo).metadata();
  const lw = meta.width ?? Math.round(size * logoRatio);
  const lh = meta.height ?? Math.round(size * logoRatio);
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
    .composite([
      { input: plate, left: 0, top: 0 },
      { input: logo, left, top },
    ])
    .png()
    .toFile(outPath);
}

function pngToIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry.writeUInt8(32, 0);
  entry.writeUInt8(32, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);

  return Buffer.concat([header, entry, png]);
}

function luma01(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function sat01(r, g, b) {
  const mx = Math.max(r, g, b);
  if (mx <= 0) return 0;
  return (mx - Math.min(r, g, b)) / mx;
}

async function verifyTransparentCorners(label, path) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const px = (x, y) => {
    const i = (y * w + x) * 4;
    return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
  };
  const corners = [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)];
  const okCorners = corners.every((c) => c.a === 0);
  console.log(
    `[pwa-icons] ${label} corners`,
    corners.map((c) => `rgba(${c.r},${c.g},${c.b},${c.a})`).join(' '),
  );
  console.log(`[pwa-icons] ${label} verifyCornersAlpha0`, okCorners);
  return okCorners;
}

await makePlatedIcon(192, ANY_LOGO_RATIO, join(outDir, 'onix-any-192.png'));
await makePlatedIcon(512, ANY_LOGO_RATIO, join(outDir, 'onix-any-512.png'));
await makePlatedIcon(512, MASKABLE_LOGO_RATIO, join(outDir, 'onix-maskable-512.png'));
await makeTransparentIcon(180, FAVICON_RATIO, join(outDir, 'onix-apple-180.png'));
await makeTransparentIcon(32, FAVICON_RATIO, join(outDir, 'onix-fav-32.png'));
await makeTransparentIcon(16, FAVICON_RATIO, join(outDir, 'onix-fav-16.png'));

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

console.log('[pwa-icons] wrote icons ->', outDir);
console.log('[pwa-icons] plated any/maskable; transparent favicons');

let allOk = true;
allOk = (await verifyTransparentCorners('onix-any-512', join(outDir, 'onix-any-512.png'))) && allOk;
allOk = (await verifyTransparentCorners('onix-any-192', join(outDir, 'onix-any-192.png'))) && allOk;
allOk = (await verifyTransparentCorners('onix-fav-32', join(outDir, 'onix-fav-32.png'))) && allOk;

// Favicon must not keep an opaque black plate in the outer ring.
{
  const { data, info } = await sharp(join(outDir, 'onix-fav-32.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  let opaqueNearBlackPlate = 0;
  const ring = 3;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inRing = x < ring || y < ring || x >= w - ring || y >= h - ring;
      if (!inRing) continue;
      const i = (y * w + x) * 4;
      const a = data[i + 3];
      if (a < 128) continue;
      const L = luma01(data[i], data[i + 1], data[i + 2]);
      const s = sat01(data[i], data[i + 1], data[i + 2]);
      if (L <= 0.14 && s < 0.22) opaqueNearBlackPlate++;
    }
  }
  console.log('[pwa-icons] onix-fav-32 outerRing opaqueNearBlackPlate', opaqueNearBlackPlate);
  if (opaqueNearBlackPlate > 0) allOk = false;
}

if (!allOk) process.exitCode = 1;
