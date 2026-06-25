import 'dotenv/config'; // ИСПРАВЛЕНИЕ: Автоматически загружает переменные из файла .env
// @ts-ignore
import { defineConfig, env } from '@prisma/config';

export default defineConfig({
  datasource: {
    url: env('DATABASE_URL'),
  },
});
