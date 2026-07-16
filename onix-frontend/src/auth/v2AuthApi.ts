import type { ApiEnvelope } from '../api/contracts';

/** Exact shape returned inside `{ success, data }` from POST /api/v2/auth/login. */
export type AuthV2LoginData = {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  refreshMaxAgeSeconds: number;
  trustedDevice: boolean;
  user: {
    id: string;
    onixId: string;
    isAdmin: boolean;
    sessionVersion: number;
    permissionVersion: number;
  };
  session: {
    id: string;
    deviceName?: string | null;
    browser?: string | null;
    os?: string | null;
    country?: string | null;
    lastSeenAt: string;
    createdAt: string;
    expiresAt: string;
    rememberMe: boolean;
  };
};

/** Exact shape returned inside `{ success, data }` from GET /api/v2/auth/me. */
export type AuthV2MeData = {
  id: string;
  onixId: string;
  isAdmin: boolean;
  sessionId: string;
  sessionVersion: number;
  permissionVersion: number;
  roles: string[];
  permissions: string[];
};

/** Body for POST /api/v2/auth/login (matches backend LoginDto). */
export type AuthV2LoginRequest = {
  telegram: {
    id: string;
    first_name: string;
    last_name?: string;
    username?: string;
    photo_url?: string;
    auth_date: number;
    hash: string;
  };
  rememberMe?: boolean;
  device?: {
    deviceName?: string;
    browser?: string;
    os?: string;
    platform?: string;
    timezone?: string;
    language?: string;
    userAgent?: string;
    fingerprintHash?: string;
    screenResolution?: string;
    browserId?: string;
  };
};

export class AuthV2ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'AuthV2ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type AuthV2Fetch = (input: string, init?: RequestInit) => Promise<Response>;

async function readEnvelope<T>(response: Response): Promise<T> {
  let payload: ApiEnvelope<T> | undefined;
  try {
    payload = await response.json() as ApiEnvelope<T>;
  } catch {
    throw new AuthV2ApiError('Сервер вернул некорректный ответ.', response.status);
  }
  if (!response.ok || !payload.success) {
    const detail = payload.error?.message;
    const message = Array.isArray(detail) ? detail.join(' ') : detail;
    throw new AuthV2ApiError(
      message || payload.message || 'Запрос авторизации не выполнен.',
      response.status,
      payload.error?.code,
      payload.error?.details,
    );
  }
  return payload.data;
}

/**
 * POST /api/v2/auth/login — credentials include so Set-Cookie (__Host-onix_rt) is stored.
 */
export async function postAuthV2Login(
  body: AuthV2LoginRequest,
  fetchImpl: AuthV2Fetch = fetch,
  apiBase = '',
): Promise<AuthV2LoginData> {
  const response = await fetchImpl(`${apiBase}/api/v2/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await readEnvelope<AuthV2LoginData>(response);
  if (!data.accessToken || !Number.isFinite(data.expiresIn)) {
    throw new AuthV2ApiError('Login response missing accessToken/expiresIn.', response.status);
  }
  return data;
}

/**
 * GET /api/v2/auth/me — Bearer Ed25519 access (AuthV2Guard).
 */
export async function getAuthV2Me(
  accessToken: string,
  fetchImpl: AuthV2Fetch = fetch,
  apiBase = '',
): Promise<AuthV2MeData> {
  const response = await fetchImpl(`${apiBase}/api/v2/auth/me`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  return readEnvelope<AuthV2MeData>(response);
}

/** Cookie-only session probe — no Bearer, no Telegram, no token rotation. */
export type AuthV2SessionData = {
  authenticated: true;
  cookiePresent: true;
  user: {
    id: string;
    onixId: string;
    isAdmin: boolean;
    sessionVersion: number;
    permissionVersion: number;
  };
  session: {
    id: string;
    rememberMe: boolean;
    lastSeenAt: string;
    createdAt: string;
    expiresAt: string;
    refreshExpiresAt: string;
  };
};

/**
 * GET /api/v2/auth/session — HttpOnly refresh cookie only.
 */
export async function getAuthV2Session(
  fetchImpl: AuthV2Fetch = fetch,
  apiBase = '',
): Promise<AuthV2SessionData> {
  const response = await fetchImpl(`${apiBase}/api/v2/auth/session`, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  return readEnvelope<AuthV2SessionData>(response);
}
