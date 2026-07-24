/**
 * Knock out near-black / near-achromatic background from the Onix brand mark
 * via edge flood-fill. Only pixels that are (a) near-black (low luma + low chroma)
 * OR already nearly transparent AND (b) connected to the image border are keyed
 * transparent — interior dark logo crevices, purple rim glow, and specular
 * highlights are kept.
 *
 * Usage:
 *   node scripts/knockout-brand-mark.mjs [source.png] [dest.png]
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const defaultSrc = join(root, 'public', 'brand', 'onix-mark-source.png');
const defaultDest = join(root, 'public', 'brand', 'onix-mark.png');

const srcPath = process.argv[2] || defaultSrc;
const destPath = process.argv[3] || defaultDest;

/** Relative luminance (sRGB approx). */
function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Chroma as max-min channel delta (0 = achromatic). */
function chroma(r, g, b) {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/**
 * Background candidate: near-black / near-achromatic plate (or already transparent).
 * Dark purple logo body has higher chroma and is not keyed.
 * Purple rim glow has higher luma and/or chroma and is not keyed.
 */
function isNearBlackBg(r, g, b, a) {
  if (a < 8) return true;
  const L = luma(r, g, b);
  const C = chroma(r, g, b);
  // Dark plate + faint dark fringe on edges; leave purple body/glow alone.
  if (L <= 28 && C <= 14) return true;
  // Low-alpha achromatic haze (compressed black plate remnants).
  if (a < 48 && L <= 40 && C <= 10) return true;
  return false;
}

function knockoutNearBlackEdges(data, width, height) {
  const n = width * height;
  const out = Buffer.alloc(n * 4);
  const transparent = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    out[o] = data[o];
    out[o + 1] = data[o + 1];
    out[o + 2] = data[o + 2];
    out[o + 3] = data[o + 3];
  }

  const queue = new Int32Array(n);
  let qh = 0;
  let qt = 0;

  const tryEnqueue = (x, y) => {
    const i = y * width + x;
    if (transparent[i]) return;
    const o = i * 4;
    if (!isNearBlackBg(data[o], data[o + 1], data[o + 2], data[o + 3])) return;
    transparent[i] = 1;
    queue[qt++] = i;
  };

  for (let x = 0; x < width; x++) {
    tryEnqueue(x, 0);
    tryEnqueue(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    tryEnqueue(0, y);
    tryEnqueue(width - 1, y);
  }

  while (qh < qt) {
    const i = queue[qh++];
    const x = i % width;
    const y = (i / width) | 0;
    if (x > 0) tryEnqueue(x - 1, y);
    if (x + 1 < width) tryEnqueue(x + 1, y);
    if (y > 0) tryEnqueue(x, y - 1);
    if (y + 1 < height) tryEnqueue(x, y + 1);
  }

  for (let i = 0; i < n; i++) {
    if (transparent[i]) {
      const d = i * 4;
      out[d] = 0;
      out[d + 1] = 0;
      out[d + 2] = 0;
      out[d + 3] = 0;
    }
  }

  return out;
}

async function main() {
  const { data, info } = await sharp(srcPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 4) {
    throw new Error(`Expected 4-channel RGBA source, got ${info.channels}`);
  }

  const keyed = knockoutNearBlackEdges(data, info.width, info.height);

  mkdirSync(dirname(destPath), { recursive: true });

  await sharp(keyed, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .trim({ threshold: 0 })
    .png()
    .toBuffer()
    .then((buf) =>
      sharp(buf)
        .trim({ threshold: 1 })
        .png()
        .toFile(destPath),
    );

  const meta = await sharp(destPath).metadata();
  const { data: outData, info: outInfo } = await sharp(destPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = outInfo.width;
  const h = outInfo.height;
  const corner = (x, y) => {
    const i = (y * w + x) * 4;
    return `rgba(${outData[i]},${outData[i + 1]},${outData[i + 2]},${outData[i + 3]})`;
  };

  console.log('[knockout] wrote', destPath);
  console.log(
    '[knockout] size',
    `${meta.width}x${meta.height}`,
    'channels',
    meta.channels,
    'hasAlpha',
    meta.hasAlpha,
  );
  console.log(
    '[knockout] corners',
    corner(0, 0),
    corner(w - 1, 0),
    corner(0, h - 1),
    corner(w - 1, h - 1),
  );
}

await main();
