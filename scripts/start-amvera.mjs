/**
 * Amvera injects UI env only at runtime. Load optional .env files, then migrate.
 */
import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { config as loadDotenv } from 'dotenv';

for (const path of ['/app/.env', '/data/.env', '.env']) {
  if (existsSync(path)) loadDotenv({ path, override: false });
}

function firstPresent(names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return { name, value };
  }
  return null;
}

const db = firstPresent(['DATABASE_URL', 'database_url', 'DATABASE-URL']);
if (db && db.name !== 'DATABASE_URL') {
  process.env.DATABASE_URL = db.value;
}

if (!process.env.DATABASE_URL?.trim()) {
  const keys = Object.keys(process.env).sort();
  const interesting = keys.filter((k) =>
    /^(AMVERA|DATABASE|BOT_|REDIS|NODE_ENV|PORT|COORDINATION|AUTH_|JWT)/i.test(k),
  );
  console.error('[amvera] DATABASE_URL is missing in process.env.');
  console.error(`[amvera] cwd=${process.cwd()} AMVERA=${process.env.AMVERA ?? ''} envCount=${keys.length}`);
  console.error(`[amvera] interesting keys: ${interesting.join(',') || '(none)'}`);
  console.error(
    '[amvera] In Amvera → Variables, turn OFF «Это секрет» for DATABASE_URL, Apply, set replicas to 0, then back to 1.',
  );
  process.exit(1);
}

const migrate = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});
if ((migrate.status ?? 1) !== 0) {
  process.exit(migrate.status ?? 1);
}

const child = spawn(process.execPath, ['dist/main.js'], {
  stdio: 'inherit',
  env: process.env,
});

const forward = (signal) => {
  if (!child.killed) child.kill(signal);
};

process.on('SIGINT', () => forward('SIGINT'));
process.on('SIGTERM', () => forward('SIGTERM'));

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(1);
  }
  process.exit(code ?? 1);
});
