import {
  CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, Injectable,
  SetMetadata, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AdminRole } from '@prisma/client';
import { AuthPlatformError } from '../auth-v2/auth-errors';
import type { AdminActor } from './admin-session.service';
import { AdminSessionService } from './admin-session.service';

export type AdminAuthRequest = {
  admin?: AdminActor;
  headers: Record<string, string | string[] | undefined>;
};

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminActor => {
    const req = ctx.switchToHttp().getRequest<AdminAuthRequest>();
    if (!req.admin) throw new UnauthorizedException('Требуется admin-сессия.');
    return req.admin;
  },
);

const ADMIN_ROLES_KEY = 'admin_roles';
export const AdminRoles = (...roles: AdminRole[]) => SetMetadata(ADMIN_ROLES_KEY, roles);

/**
 * Accepts only admin_access JWTs. Customer tokens (typ=access / aud=onix-web) are rejected.
 */
@Injectable()
export class AdminAccessGuard implements CanActivate {
  constructor(private readonly sessions: AdminSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AdminAuthRequest>();
    const value = req.headers.authorization;
    const header = Array.isArray(value) ? value[0] : value;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Требуется admin-сессия.');
    }
    const token = header.slice('Bearer '.length).trim();
    try {
      req.admin = await this.sessions.validateAccess(token);
      return true;
    } catch (error) {
      if (error instanceof AuthPlatformError) {
        throw new UnauthorizedException(error.message);
      }
      throw error;
    }
  }
}

@Injectable()
export class AdminRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AdminRole[]>(ADMIN_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const req = context.switchToHttp().getRequest<AdminAuthRequest>();
    if (!req.admin || !required.includes(req.admin.role)) {
      throw new ForbiddenException('Недостаточно прав admin-роли.');
    }
    return true;
  }
}
