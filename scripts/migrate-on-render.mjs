/**
 * Free Render web services do not run preDeployCommand.
 * Apply pending Prisma migrations during the Render build instead.
 * Local `npm run build:web` is unchanged (RENDER is unset).
 */
import { spawnSync } from 'node:child_process';

if (process.env.RENDER !== 'true') process.exit(0);

const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  shell: true,
});
process.exit(result.status ?? 1);
