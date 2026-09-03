import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { resolveClientIp } from './client-ip';
import { DistributedRateLimiter } from '../rate-limit';

const SKIP = new Set([
  '/api/health/live',
  '/api/health/ready',
]);

@Injectable()
export class GlobalHttpRateLimitMiddleware implements NestMiddleware {
  constructor(private readonly rateLimit: DistributedRateLimiter) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const path = (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '';
    if (!path.startsWith('/api') || SKIP.has(path)) {
      next();
      return;
    }
    const ip = resolveClientIp(req) ?? req.ip ?? 'unknown';
    const windowMs = 60_000;
    const limit = path.startsWith('/api/admin/auth')
      ? 40
      : 240;
    try {
      await this.rateLimit.assert(`http:${ip}`, limit, windowMs);
      next();
    } catch (err) {
      next(err);
    }
  }
}
