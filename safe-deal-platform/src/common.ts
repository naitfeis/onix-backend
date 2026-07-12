import {
  ArgumentsHost, BadRequestException, CallHandler, Catch, createParamDecorator,
  ExecutionContext, ExceptionFilter, HttpException, HttpStatus, Injectable,
  NestInterceptor, SetMetadata,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

export interface AuthUser {
  id: bigint;
  telegramId: bigint;
  onixId: string;
  isAdmin: boolean;
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
    const response = host.switchToHttp().getResponse();
    const status = error instanceof HttpException ? error.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = error instanceof HttpException ? error.getResponse() : null;
    const details = typeof raw === 'object' && raw ? raw : undefined;
    const message = typeof raw === 'string'
      ? raw
      : (details as { message?: string | string[] } | undefined)?.message ?? 'Внутренняя ошибка сервера.';
    response.status(status).json({
      success: false,
      error: {
        code: error instanceof HttpException ? error.name : 'InternalServerError',
        message,
        ...(details ? { details } : {}),
      },
    });
  }
}

export function parseId(value: string, field = 'id'): bigint {
  if (!/^\d+$/.test(value)) throw new BadRequestException(`${field} должен быть числовой строкой.`);
  return BigInt(value);
}
