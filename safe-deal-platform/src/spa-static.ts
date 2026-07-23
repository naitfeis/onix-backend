import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DynamicModule } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { structuredLog } from './observability/structured-logger';

/**
 * Vite SPA on the same Render service as /api (same origin → __Host- cookies).
 * www.onixtg.shop points here instead of Vercel so RU works without VPN.
 */
export function resolveSpaDir(): string {
  const fromEnv = process.env.SPA_DIST_DIR?.trim();
  if (fromEnv) return fromEnv;
  return join(process.cwd(), 'public', 'spa');
}

export function spaIndexExists(spaDir = resolveSpaDir()): boolean {
  return existsSync(join(spaDir, 'index.html'));
}

/** Nest modules to import — empty when SPA was not built (API-only / worker). */
export function spaServeModules(): DynamicModule[] {
  const spaDir = resolveSpaDir();
  if (!spaIndexExists(spaDir)) {
    structuredLog.warn('SPA dist missing — only /api is served', { spaDir });
    return [];
  }
  structuredLog.info('SPA ServeStatic enabled', { spaDir });
  return [
    ServeStaticModule.forRoot({
      rootPath: spaDir,
      // Everything except Nest API (global prefix `api`).
      exclude: ['/api', '/api/(.*)'],
      serveStaticOptions: {
        index: 'index.html',
        fallthrough: false,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
            return;
          }
          if (/[/\\]assets[/\\]/.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      },
    }),
  ];
}
