import type { INestApplication } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'http';

const HEALTH_BODY = 'ONIX API';

type HealthRequest = IncomingMessage & { method?: string; url?: string; path?: string };
type HealthResponse = ServerResponse & {
  status: (code: number) => HealthResponse;
  type: (value: string) => HealthResponse;
  set: (field: string, value: string) => HealthResponse;
  send: (body: string) => void;
  end: () => void;
};

/**
 * Production health for Render (and load balancers).
 * Express middleware — runs before Nest router / AuthGuard / API envelope.
 * GET / and HEAD / → 200 OK, body "ONIX API" (HEAD has no body).
 */
export function registerHealthEndpoint(app: INestApplication): void {
  app.use((req: HealthRequest, res: HealthResponse, next: (err?: unknown) => void) => {
    const path = req.path ?? (req.url ? req.url.split('?')[0] : '');
    if (path !== '/') {
      next();
      return;
    }
    const method = (req.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      next();
      return;
    }
    res.set('Cache-Control', 'no-store');
    if (method === 'HEAD') {
      res.status(200).type('text/plain').set('Content-Length', String(Buffer.byteLength(HEALTH_BODY))).end();
      return;
    }
    res.status(200).type('text/plain').send(HEALTH_BODY);
  });
}
