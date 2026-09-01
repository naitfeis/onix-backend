/**
 * Free Render web services do not run preDeployCommand.
 * Apply pending Prisma migrations during the PaaS build instead.
 * Local `npm run build:web` is unchanged (RENDER/AMVERA unset).
 */
import { spawnSync } from 'node:child_process';

const onPaas =
  process.env.RENDER === 'true' || process.env.AMVERA === 'true';
if (!onPaas) process.exit(0);

const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  shell: true,
});
process.exit(result.status ?? 1);
