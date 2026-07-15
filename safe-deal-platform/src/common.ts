import {
  ArgumentsHost, BadRequestException, CallHandler, Catch, createParamDecorator,
  ExecutionContext, ExceptionFilter, HttpException, HttpStatus, Injectable,
  NestInterceptor, SetMetadata,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { AuthPlatformError, authErrorBody } from './auth-v2/auth-errors';
import { formatErrorForLog } from './safe-error-log';

export interface AuthUser {
  id: bigint;
  telegramId: bigint;
  onixId: string;
  isAdmin: boolean;
  /** SUPPORT staff (or admin). Used for tickets/refunds — not a bypass of Escrow. */
  isSupport: boolean;
}

/** Admin or dedicated SUPPORT agent. */
export function canActAsSupport(user: Pick<AuthUser, 'isAdmin' | 'isSupport'>): boolean {
  return user.isAdmin || user.isSupport;
}

/** Resolve SUPPORT flag from env (comma-separated Telegram IDs) + admin. */
export function resolveIsSupport(telegramId: bigint, isAdmin: boolean): boolean {
  if (isAdmin) return true;
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
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data) => ({ success: true, data: jsonSafe(data) })));
  }
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    // Never log raw Authorization / tokens / cookies / PEM — redact first.
    console.error(formatErrorForLog(error));
    const response = host.switchToHttp().getResponse();

    if (error instanceof AuthPlatformError) {
      response.status(error.httpStatus).json(authErrorBody(error));
      return;
    }

    const status = error instanceof HttpException ? error.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = error instanceof HttpException ? error.getResponse() : null;
    const details = typeof raw === 'object' && raw ? (raw as Record<string, unknown>) : undefined;
    const message = typeof raw === 'string'
      ? raw
      : (details as { message?: string | string[] } | undefined)?.message ?? 'Внутренняя ошибка сервера.';
    const field = typeof details?.field === 'string' ? details.field : undefined;
    const fieldError = typeof details?.error === 'string' ? details.error : undefined;
    response.status(status).json({
      success: false,
      error: {
        code: error instanceof HttpException ? error.name : 'InternalServerError',
        message,
        ...(field ? { field, error: fieldError ?? (typeof message === 'string' ? message : field) } : {}),
        ...(details ? { details } : {}),
      },
    });
  }
}

export function parseId(value: string, field = 'id'): bigint {
  if (!/^\d+$/.test(value)) throw new BadRequestException(`${field} должен быть числовой строкой.`);
  return BigInt(value);
}
