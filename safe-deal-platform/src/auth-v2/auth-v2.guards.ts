import {
  CanActivate, ExecutionContext, Injectable, SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthPlatformError } from './auth-errors';
import { RbacService } from './rbac.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

export const REQUIRE_PERMISSIONS_KEY = 'auth_v2_permissions';
export const REQUIRE_ROLES_KEY = 'auth_v2_roles';

export const RequirePermissions = (...codes: string[]) => SetMetadata(REQUIRE_PERMISSIONS_KEY, codes);
export const RequireRoles = (...codes: string[]) => SetMetadata(REQUIRE_ROLES_KEY, codes);

export interface AuthV2RequestUser {
  id: bigint;
  onixId: string;
  isAdmin: boolean;
  sessionId: string;
  sessionVersion: number;
  permissionVersion: number;
  permissions: string[];
  roles: string[];
}

export type AuthV2Request = {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthV2RequestUser;
};

@Injectable()
export class AuthV2Guard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly rbac: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthV2Request>();
    const authorization = headerValue(request.headers, 'authorization');
    if (!authorization?.startsWith('Bearer ')) {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Bearer access token is required.');
    }
    const raw = authorization.slice('Bearer '.length).trim();
    const claims = this.tokens.verifyAccessToken(raw);
    const { user, session } = await this.sessions.validateAccessClaims(claims);
    const { permissions, roles } = await this.rbac.resolveForUser(user.id, user.permissionVersion);

    request.user = {
      id: user.id,
      onixId: user.onixId,
      isAdmin: user.isAdmin,
      sessionId: session.id,
      sessionVersion: user.sessionVersion,
      permissionVersion: user.permissionVersion,
      permissions,
      roles,
    };
    return true;
  }
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRE_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const request = context.switchToHttp().getRequest<AuthV2Request>();
    const permissions = request.user?.permissions ?? [];
    const ok = required.every((code) => permissions.includes(code) || request.user?.isAdmin === true);
    if (!ok) {
      throw new AuthPlatformError('AUTH_ACCOUNT_DISABLED', 'Missing required permission.');
    }
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRE_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const request = context.switchToHttp().getRequest<AuthV2Request>();
    const roles = request.user?.roles ?? [];
    const ok = required.some((code) => roles.includes(code)) || request.user?.isAdmin === true;
    if (!ok) {
      throw new AuthPlatformError('AUTH_ACCOUNT_DISABLED', 'Missing required role.');
    }
    return true;
  }
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(raw) ? raw[0] : raw;
}
