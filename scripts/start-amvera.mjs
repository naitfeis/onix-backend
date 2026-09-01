/**
 * Amvera has no build-time env (DATABASE_URL is injected only at runtime).
 * Migrate here, then hand off to the same process as Render start.
 */
import { spawn, spawnSync } from 'node:child_process';

if (!process.env.DATABASE_URL?.trim()) {
  console.error(
    '[amvera] DATABASE_URL is missing. Add the Neon URL in Amvera → Variables, then restart.',
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
