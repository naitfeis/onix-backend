import 'dotenv/config';
// @ts-ignore
import { defineConfig, env } from '@prisma/config';

// `prisma generate` / `tsc` run on Amvera at build time, where env vars are
// not injected. Generate does not connect; migrate still uses the real URL at start.
if (!process.env.DATABASE_URL?.trim()) {
  process.env.DATABASE_URL = 'postgresql://prisma:prisma@127.0.0.1:5432/prisma';
}

export default defineConfig({
  datasource: {
    url: env('DATABASE_URL'),
  },
});
