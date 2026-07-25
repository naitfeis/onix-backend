/**
 * Copy Vite builds → public/spa for Nest to serve on Render.
 * - onix-frontend/dist → public/spa
 * - onix-admin/dist    → public/spa/admin  (separate Security Ops Console)
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const customerSrc = join(root, 'onix-frontend', 'dist');
const adminSrc = join(root, 'onix-admin', 'dist');
const dest = join(root, 'public', 'spa');
const customerIndex = join(customerSrc, 'index.html');
const adminIndex = join(adminSrc, 'index.html');

if (!existsSync(customerIndex)) {
  console.error(`[sync-spa] missing ${customerIndex} — run: npm run build --prefix onix-frontend`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(customerSrc, dest, { recursive: true });
console.log(`[sync-spa] customer → ${dest}`);

if (existsSync(adminIndex)) {
  const adminDest = join(dest, 'admin');
  mkdirSync(adminDest, { recursive: true });
  cpSync(adminSrc, adminDest, { recursive: true });
  console.log(`[sync-spa] admin → ${adminDest}`);
} else {
  console.warn(`[sync-spa] admin dist missing — /admin will 404 until: npm run build --prefix onix-admin`);
}
