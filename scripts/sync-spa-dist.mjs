/**
 * Copy Vite build (onix-frontend/dist) → public/spa for Nest to serve on Render.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'onix-frontend', 'dist');
const dest = join(root, 'public', 'spa');
const indexHtml = join(src, 'index.html');

if (!existsSync(indexHtml)) {
  console.error(`[sync-spa] missing ${indexHtml} — run: npm run build --prefix onix-frontend`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`[sync-spa] synced → ${dest}`);
