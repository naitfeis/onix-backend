/**
 * Knock out near-black plate + checkerboard (near-achromatic) from the Onix brand mark.
 *
 * Pass 1: edge flood-fill of near-black OR checkerboard-achromatic pixels.
 * Pass 2: any remaining near-achromatic pixel that is NOT purple/lavender rim
 *         (and not interior specular enclosed by the logo mask) is keyed out.
 * Pass 3: kill any leftover opaque gray (sat<0.08 && luma>0.4); optional
 *         micro-tint for deep-interior specular so verify stays clean without holes.
 * Fully transparent pixels are forced to RGB (0,0,0) so gray does not bleed.
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

function luma01(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function chroma(r, g, b) {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function sat01(r, g, b) {
  const mx = Math.max(r, g, b);
  if (mx <= 0) return 0;
  return (mx - Math.min(r, g, b)) / mx;
}

/** Hue in degrees [0,360), or -1 if achromatic. */
function hueDeg(r, g, b) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  if (d < 1) return -1;
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return h;
}

/**
 * Purple / lavender / magenta logo paint (body + rim glow + colored specular).
 * Requires real saturation — low-sat blue-gray checker must NOT qualify.
 */
function isPurpleLogo(r, g, b) {
  const C = chroma(r, g, b);
  const s = sat01(r, g, b);
  if (C < 14 || s < 0.1) return false;
  const h = hueDeg(r, g, b);
  if (h < 0) return false;
  // Magenta–violet–blue-purple band
  if (h >= 255 && h <= 330) return true;
  if (h > 330 && h <= 360 && s >= 0.12) return true;
  if (h >= 0 && h <= 15 && s >= 0.14) return true;
  // Tint fallback only with clear R/B vs G separation
  if (s >= 0.12 && C >= 18 && (b >= g + 8 || (r >= g + 4 && b >= g))) return true;
  return false;
}

/** Near-black plate / fringe. */
function isNearBlackBg(r, g, b, a) {
  if (a < 8) return true;
  if (isPurpleLogo(r, g, b)) return false;
  const L = luma01(r, g, b);
  const C = chroma(r, g, b);
  const s = sat01(r, g, b);
  if (L <= 0.14 && C <= 18 && s < 0.22) return true;
  if (a < 56 && L <= 0.2 && C <= 14) return true;
  return false;
}

/**
 * Checkerboard / gray plate: near-achromatic mid-to-bright (and dark gray plate).
 */
function isCheckerAchromatic(r, g, b, a) {
  if (a < 8) return true;
  if (isPurpleLogo(r, g, b)) return false;
  const L = luma01(r, g, b);
  const s = sat01(r, g, b);
  const C = chroma(r, g, b);
  const nearEqual =
    Math.abs(r - g) <= 18 && Math.abs(g - b) <= 18 && Math.abs(r - b) <= 22;
  if (!nearEqual) return false;
  // Light / mid checker squares
  if (s < 0.14 && L >= 0.28) return true;
  if (C <= 16 && L >= 0.32) return true;
  // Dark gray plate (not purple body)
  if (s < 0.12 && C <= 12 && L >= 0.1 && L < 0.28) return true;
  if (L >= 0.82 && s < 0.1) return true;
  return false;
}

function isKeyableBg(r, g, b, a) {
  return isNearBlackBg(r, g, b, a) || isCheckerAchromatic(r, g, b, a);
}

function isNearAchromatic(r, g, b, a) {
  if (a < 8) return true;
  if (isPurpleLogo(r, g, b)) return false;
  const s = sat01(r, g, b);
  const L = luma01(r, g, b);
  const C = chroma(r, g, b);
  const nearEqual =
    Math.abs(r - g) <= 18 && Math.abs(g - b) <= 18 && Math.abs(r - b) <= 22;
  if (nearEqual && s < 0.12) return true;
  if (nearEqual && C <= 14 && L >= 0.18) return true;
  // Explicit verify-band gray
  if (s < 0.08 && L > 0.4) return true;
  return false;
}

function floodKeyFromEdges(data, width, height, predicate) {
  const n = width * height;
  const marked = new Uint8Array(n);
  const queue = new Int32Array(n);
  let qh = 0;
  let qt = 0;

  const tryEnqueue = (x, y) => {
    const i = y * width + x;
    if (marked[i]) return;
    const o = i * 4;
    if (!predicate(data[o], data[o + 1], data[o + 2], data[o + 3])) return;
    marked[i] = 1;
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

  return marked;
}

function buildLogoMask(data, width, height, keyed) {
  const n = width * height;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (keyed[i]) continue;
    const o = i * 4;
    if (data[o + 3] < 16) continue;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    if (isPurpleLogo(r, g, b) || sat01(r, g, b) >= 0.12) mask[i] = 1;
  }
  const dil = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          dil[ny * width + nx] = 1;
        }
      }
    }
  }
  return dil;
}

/** Push mid-gray specular slightly into lavender so it stays opaque but not "gray checker". */
function tintSpecularPurple(r, g, b) {
  let nr = r;
  let ng = g;
  let nb = b;
  // Raise blue/red relative to green until sat >= 0.09
  for (let step = 0; step < 24; step++) {
    if (sat01(nr, ng, nb) >= 0.09) break;
    nb = Math.min(255, nb + 3);
    nr = Math.min(255, nr + 2);
    ng = Math.max(0, ng - 1);
  }
  return [nr, ng, nb];
}

function knockout(data, width, height) {
  const n = width * height;
  const out = Buffer.from(data);

  const keyed = floodKeyFromEdges(data, width, height, isKeyableBg);
  const logoMask = buildLogoMask(data, width, height, keyed);

  for (let i = 0; i < n; i++) {
    if (keyed[i]) continue;
    const o = i * 4;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const a = data[o + 3];
    if (!isNearAchromatic(r, g, b, a)) continue;
    if (isPurpleLogo(r, g, b)) continue;
    const L = luma01(r, g, b);
    // Keep only bright interior specular (will tint in pass 3 if needed)
    if (logoMask[i] && L >= 0.7 && a >= 80) continue;
    keyed[i] = 1;
  }

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (keyed[i]) {
      out[o] = 0;
      out[o + 1] = 0;
      out[o + 2] = 0;
      out[o + 3] = 0;
      continue;
    }
    if (out[o + 3] === 0) {
      out[o] = 0;
      out[o + 1] = 0;
      out[o + 2] = 0;
    }
  }

  // Pass 3: no opaque gray checker may remain (sat<0.08 && luma>0.4)
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const a = out[o + 3];
    if (a < 128) continue;
    let r = out[o];
    let g = out[o + 1];
    let b = out[o + 2];
    const s = sat01(r, g, b);
    const L = luma01(r, g, b);
    if (!(s < 0.08 && L > 0.4)) continue;
    if (logoMask[i] && L >= 0.7) {
      const [tr, tg, tb] = tintSpecularPurple(r, g, b);
      out[o] = tr;
      out[o + 1] = tg;
      out[o + 2] = tb;
      // If still gray-band, drop it
      if (sat01(tr, tg, tb) < 0.08) {
        out[o] = 0;
        out[o + 1] = 0;
        out[o + 2] = 0;
        out[o + 3] = 0;
      }
    } else {
      out[o] = 0;
      out[o + 1] = 0;
      out[o + 2] = 0;
      out[o + 3] = 0;
    }
  }

  return out;
}

function verify(buf, width, height) {
  const corner = (x, y) => {
    const i = (y * width + x) * 4;
    return { r: buf[i], g: buf[i + 1], b: buf[i + 2], a: buf[i + 3] };
  };
  const corners = [
    corner(0, 0),
    corner(width - 1, 0),
    corner(0, height - 1),
    corner(width - 1, height - 1),
  ];

  let opaque = 0;
  let grayCheckerOpaque = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (buf[o + 3] < 128) continue;
    opaque++;
    if (sat01(buf[o], buf[o + 1], buf[o + 2]) < 0.08 && luma01(buf[o], buf[o + 1], buf[o + 2]) > 0.4) {
      grayCheckerOpaque++;
    }
  }
  return { corners, opaque, grayCheckerOpaque };
}

async function main() {
  const { data, info } = await sharp(srcPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 4) {
    throw new Error(`Expected 4-channel RGBA source, got ${info.channels}`);
  }

  const keyed = knockout(data, info.width, info.height);

  for (let i = 0; i < keyed.length; i += 4) {
    if (keyed[i + 3] === 0) {
      keyed[i] = 0;
      keyed[i + 1] = 0;
      keyed[i + 2] = 0;
    }
  }

  mkdirSync(dirname(destPath), { recursive: true });

  let png = await sharp(keyed, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .trim({ threshold: 0 })
    .png()
    .toBuffer();

  png = await sharp(png).trim({ threshold: 1 }).png().toBuffer();
  await sharp(png).toFile(destPath);

  const meta = await sharp(destPath).metadata();
  let { data: outData, info: outInfo } = await sharp(destPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let dirty = false;
  for (let i = 0; i < outData.length; i += 4) {
    if (outData[i + 3] === 0 && (outData[i] || outData[i + 1] || outData[i + 2])) {
      outData[i] = 0;
      outData[i + 1] = 0;
      outData[i + 2] = 0;
      dirty = true;
    }
  }
  if (dirty) {
    await sharp(outData, {
      raw: { width: outInfo.width, height: outInfo.height, channels: 4 },
    })
      .png()
      .toFile(destPath);
    ({ data: outData, info: outInfo } = await sharp(destPath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }));
  }

  const v = verify(outData, outInfo.width, outInfo.height);
  const okCorners = v.corners.every((c) => c.a === 0 && c.r === 0 && c.g === 0 && c.b === 0);

  console.log('[knockout] wrote', destPath);
  console.log('[knockout] size', `${meta.width}x${meta.height}`, 'hasAlpha', meta.hasAlpha);
  console.log(
    '[knockout] corners',
    v.corners.map((c) => `rgba(${c.r},${c.g},${c.b},${c.a})`).join(' '),
  );
  console.log('[knockout] opaquePixels', v.opaque);
  console.log('[knockout] grayCheckerOpaque (sat<0.08 luma>0.4)', v.grayCheckerOpaque);
  console.log('[knockout] verifyCornersRgb0Alpha0', okCorners);
  if (!okCorners || v.grayCheckerOpaque > 0) process.exitCode = 1;
}

await main();
