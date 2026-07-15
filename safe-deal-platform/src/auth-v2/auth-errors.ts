/**
 * Stable machine-readable auth error codes (ADR-029).
 * Used by /api/v2/auth; legacy Mini App paths keep existing UnauthorizedException messages.
 */

export type AuthErrorCode =
  | 'AUTH_INVALID_TOKEN'
  | 'AUTH_REFRESH_MISSING'
  | 'AUTH_REFRESH_REUSED'
  | 'AUTH_SESSION_EXPIRED'
  | 'AUTH_SESSION_LIMIT'
  | 'AUTH_ACCOUNT_LOCKED'
  | 'AUTH_ACCOUNT_DISABLED'
  | 'AUTH_STEP_UP_REQUIRED'
  | 'AUTH_PROVIDER_REJECTED'
  | 'AUTH_IDENTITY_CONFLICT'
  | 'AUTH_ACCOUNT_MERGE_REQUIRED'
  | 'AUTH_LAST_FACTOR'
  | 'AUTH_RATE_LIMITED'
  | 'AUTH_CSRF_REJECTED'
  | 'AUTH_MISCONFIGURED'
  | 'AUTH_INTERNAL'
  | 'AUTH_LOGIN_CHALLENGE_INVALID'
  | 'AUTH_LOGIN_CHALLENGE_EXPIRED'
  | 'AUTH_LOGIN_CHALLENGE_CONSUMED'
  | 'AUTH_LOGIN_CHALLENGE_PENDING'
  | 'AUTH_LOGIN_CHALLENGE_STATE';

const HTTP_BY_CODE: Record<AuthErrorCode, number> = {
  AUTH_INVALID_TOKEN: 401,
  AUTH_REFRESH_MISSING: 401,
  AUTH_REFRESH_REUSED: 401,
  AUTH_SESSION_EXPIRED: 401,
  AUTH_SESSION_LIMIT: 409,
  AUTH_ACCOUNT_LOCKED: 403,
  AUTH_ACCOUNT_DISABLED: 403,
  AUTH_STEP_UP_REQUIRED: 403,
  AUTH_PROVIDER_REJECTED: 401,
  AUTH_IDENTITY_CONFLICT: 409,
  AUTH_ACCOUNT_MERGE_REQUIRED: 409,
  AUTH_LAST_FACTOR: 400,
  AUTH_RATE_LIMITED: 429,
  AUTH_CSRF_REJECTED: 403,
  AUTH_MISCONFIGURED: 503,
  AUTH_INTERNAL: 500,
  AUTH_LOGIN_CHALLENGE_INVALID: 400,
  AUTH_LOGIN_CHALLENGE_EXPIRED: 401,
  AUTH_LOGIN_CHALLENGE_CONSUMED: 409,
  AUTH_LOGIN_CHALLENGE_PENDING: 409,
  AUTH_LOGIN_CHALLENGE_STATE: 409,
};

export class AuthPlatformError extends Error {
  readonly code: AuthErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(code: AuthErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AuthPlatformError';
    this.code = code;
    this.httpStatus = HTTP_BY_CODE[code];
    this.details = details;
  }
}

export function authErrorBody(error: AuthPlatformError): {
  success: false;
  error: { code: AuthErrorCode; message: string; details?: unknown };
} {
  return {
    success: false,
    error: {
      code: error.code,
      message: error.message,
      ...(error.details !== undefined ? { details: error.details } : {}),
    },
  };
}
