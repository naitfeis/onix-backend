import {
  ArgumentsHost, BadRequestException, CallHandler, Catch, createParamDecorator,
  ExecutionContext, ExceptionFilter, HttpException, HttpStatus, Injectable,
  NestInterceptor, Optional, SetMetadata,
} from '@nestjs/common';
import type { PlatformStatus } from '@prisma/client';
import { Observable, map } from 'rxjs';
import { AuthPlatformError, authErrorBody } from './auth-v2/auth-errors';
import { ErrorTrackingService } from './observability/error-tracking.service';
import { isStaffPlatformStatus } from './platform-status';
import { structuredLog } from './observability/structured-logger';
import { formatErrorForLog } from './safe-error-log';

export interface AuthUser {
  id: bigint;
  telegramId: bigint | null;
  onixId: string;
  isAdmin: boolean;
  /** SUPPORT staff (or admin). Used for tickets/refunds — not a bypass of Escrow. */
  isSupport: boolean;
  /** Canonical RBAC source when present — prefer over boolean flags for staff UI. */
  platformStatus?: PlatformStatus;
  /** Present for EdDSA / v2 access tokens — used by Risk Engine. */
  sessionId?: string;
}

/** Admin or dedicated SUPPORT agent. */
export function canActAsSupport(user: Pick<AuthUser, 'isAdmin' | 'isSupport' | 'platformStatus'>): boolean {
  return user.isAdmin || user.isSupport || isStaffPlatformStatus(user.platformStatus);
}

/**
 * Staff message viewer (read receipts, deleted originals).
 * Uses platformStatus when available; falls back to legacy isAdmin/isSupport flags.
 */
export function isStaffViewer(user: Pick<AuthUser, 'isAdmin' | 'isSupport' | 'platformStatus'>): boolean {
  return canActAsSupport(user);
}

/** Resolve SUPPORT flag from env (comma-separated Telegram IDs) + admin. */
export function resolveIsSupport(telegramId: bigint | null | undefined, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  if (telegramId == null) return false;
  const raw = process.env.SUPPORT_TELEGRAM_IDS ?? '';
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return ids.includes(telegramId.toString());
}

export type AuthRequest = { user: AuthUser; headers: Record<string, string | undefined> };

export const Public = () => SetMetadata('public', true);
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<AuthRequest>().user,
);

function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value instanceof Date) return value;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}

@Injectable()
export class ApiEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = context.switchToHttp().getResponse<{ headersSent?: boolean }>();
    return next.handle().pipe(map((data) => {
      if (res.headersSent) return data;
      return { success: true, data: jsonSafe(data) };
    }));
  }
}

@Catch()
@Injectable()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(@Optional() private readonly errors?: ErrorTrackingService) {}

  catch(error: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest<{
      method?: string;
      originalUrl?: string;
      url?: string;
      headers?: Record<string, string | undefined>;
      user?: { id?: bigint | string };
    }>();
    const requestId = request?.headers?.['x-request-id'];
    const userId = request?.user?.id?.toString();
    const route = `${request?.method ?? '?'} ${request?.originalUrl ?? request?.url ?? '?'}`;

    if (error instanceof AuthPlatformError) {
      // Guest / expired cookie on Website is expected — keep logs clean.
      const quietGuest = error.code === 'AUTH_REFRESH_MISSING'
        || error.code === 'AUTH_SESSION_EXPIRED'
        || error.code === 'AUTH_INVALID_TOKEN';
      if (!quietGuest) {
        structuredLog.warn('auth platform error', {
          requestId,
          userId,
          route,
          code: error.code,
        });
      }
      response.status(error.httpStatus).json(authErrorBody(error));
      return;
    }

    const status = error instanceof HttpException ? error.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const isProd = (process.env.NODE_ENV ?? '').toLowerCase() === 'production';
    if (status >= 500) {
      this.errors?.capture(error, { requestId, route, userId, level: 'error' });
    } else if (status !== 404 && status !== 401 && status !== 403) {
      // 401/403 are expected (guest / expired) — access log already records status.
      // Other 4xx: structured warn without error-tracking noise.
      structuredLog.warn(formatErrorForLog(error), { requestId, userId, route, status });
    }

    const raw = error instanceof HttpException ? error.getResponse() : null;
    const details = typeof raw === 'object' && raw ? (raw as Record<string, unknown>) : undefined;
    let message = typeof raw === 'string'
      ? raw
      : (details as { message?: string | string[] } | undefined)?.message ?? 'Внутренняя ошибка сервера.';
    const field = typeof details?.field === 'string' ? details.field : undefined;
    const fieldError = typeof details?.error === 'string' ? details.error : undefined;

    // Production 5xx: never leak stacks / internal details to clients.
    if (status >= 500 && isProd) {
      message = 'Внутренняя ошибка сервера.';
      response.status(status).json({
        success: false,
        error: {
          code: 'InternalServerError',
          message,
          ...(requestId ? { requestId } : {}),
        },
      });
      return;
    }

    response.status(status).json({
      success: false,
      error: {
        code: error instanceof HttpException ? error.name : 'InternalServerError',
        message,
        ...(field ? { field, error: fieldError ?? (typeof message === 'string' ? message : field) } : {}),
        ...(details && status < 500 ? { details } : {}),
        ...(requestId ? { requestId } : {}),
      },
    });
  }
}

export function parseId(value: string, field = 'id'): bigint {
  if (!/^\d+$/.test(value)) throw new BadRequestException(`${field} должен быть числовой строкой.`);
  return BigInt(value);
}
