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
      // path-to-regexp v8: `/api/(.*)` throws. Nest sample uses `/api/{*path}`.
      exclude: ['/api/{*path}'],
      serveStaticOptions: {
        index: 'index.html',
        // Missing assets → next() instead of Nest NotFoundException stack traces.
        fallthrough: true,
        setHeaders: (res, filePath) => {
          const base = filePath.replace(/\\/g, '/');
          if (
            base.endsWith('index.html')
            || base.endsWith('sw.js')
            || base.endsWith('registerSW.js')
            || base.endsWith('manifest.webmanifest')
            || /\/workbox-[^/]+\.js$/.test(base)
          ) {
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
