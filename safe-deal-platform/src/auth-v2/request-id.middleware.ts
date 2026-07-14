import { randomBytes } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

/** ADR-030 — correlation / request id propagation */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const existing = req.header('x-request-id')?.trim();
  const requestId = existing && existing.length > 0 ? existing : randomBytes(12).toString('hex');
  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}
