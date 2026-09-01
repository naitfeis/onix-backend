import 'dotenv/config';
// @ts-ignore
import { defineConfig, env } from '@prisma/config';

// Amvera injects env only at runtime. `prisma generate` during build has no
// DATABASE_URL and does not connect. Never use this dummy for migrate/start.
const isGenerate = process.argv.includes('generate');
if (!process.env.DATABASE_URL?.trim() && isGenerate) {
  process.env.DATABASE_URL = 'postgresql://prisma:prisma@127.0.0.1:5432/prisma';
}

export default defineConfig({
  datasource: {
    url: env('DATABASE_URL'),
  },
});
