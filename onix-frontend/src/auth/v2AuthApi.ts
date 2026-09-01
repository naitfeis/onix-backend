import type { ApiEnvelope } from '../api/contracts';
import { resilientFetch } from '../api/fetchResilience';

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
    /** Ignored by server — HMAC deviceId is derived server-side. */
    fingerprintHash?: string;
    screenResolution?: string;
    browserId?: string;
    pwaInstallId?: string;
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

export async function postAuthV2Google(
  body: { idToken: string; rememberMe?: boolean },
  fetchImpl: AuthV2Fetch = fetch,
  apiBase = '',
): Promise<AuthV2LoginData> {
  const response = await fetchImpl(`${apiBase}/api/v2/auth/google`, {
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

export type AuthV2PublicConfig = {
  googleClientId: string | null;
};

/** GET /api/v2/auth/public-config — Google Client ID for GIS (runtime, not Vite bake). */
export async function getAuthV2PublicConfig(
  fetchImpl: AuthV2Fetch = fetch,
  apiBase = '',
): Promise<AuthV2PublicConfig> {
  const response = await fetchImpl(`${apiBase}/api/v2/auth/public-config`, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  return readEnvelope<AuthV2PublicConfig>(response);
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

/**
 * POST /api/v2/auth/logout — cookie + CSRF. No Bearer required.
 */
export async function postAuthV2Logout(
  fetchImpl: AuthV2Fetch = fetch,
  apiBase = '',
): Promise<{ ok: true }> {
  const response = await fetchImpl(`${apiBase}/api/v2/auth/logout`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'X-ONIX-CSRF': '1',
    },
  });
  return readEnvelope<{ ok: true }>(response);
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
 * Keep short: hung probes used to sit at ~8s (see bootstrap session-check=8002ms)
 * while public /api/products already returned in ~20ms. Connection-reset retries
 * still apply via resilientFetch; full timeout must not retry (avoid 8s×N).
 * Server 401 still fails as soon as it arrives.
 */
export const AUTH_SESSION_PROBE_TIMEOUT_MS = 3_000;

export async function getAuthV2Session(
  fetchImpl: AuthV2Fetch = fetch,
  apiBase = '',
): Promise<AuthV2SessionData> {
  const url = `${apiBase}/api/v2/auth/session`;
  const init: RequestInit = {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  };
  // Tests inject fetchImpl and skip resilientFetch.
  const response = fetchImpl === fetch
    ? await resilientFetch(url, {
      ...init,
      timeoutMs: AUTH_SESSION_PROBE_TIMEOUT_MS,
      maxRetries: 3,
    })
    : await fetchImpl(url, init);
  return readEnvelope<AuthV2SessionData>(response);
}

export type AuthV2SessionProbe =
  | { ok: true; data: AuthV2SessionData }
  | { ok: false; reason: 'guest'; status: number; code?: string }
  | { ok: false; reason: 'network'; error: unknown };

export type RefreshCookieProbe =
  | { ok: true }
  | { ok: false; reason: 'guest'; status: number; code?: string }
  | { ok: false; reason: 'network'; error: unknown };

function errorStatus(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return undefined;
}

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

/**
 * Fast website bootstrap probe: cookie parsing only, no DB lookup.
 * The following refresh request performs the authoritative session validation
 * and token rotation, avoiding two sequential database round-trips.
 */
export async function probeRefreshCookiePresence(
  fetchImpl: AuthV2Fetch = fetch,
  apiBase = '',
): Promise<RefreshCookieProbe> {
  try {
    const url = `${apiBase}/api/session-probe`;
    const init: RequestInit = {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    };
    const response = fetchImpl === fetch
      ? await resilientFetch(url, {
        ...init,
        timeoutMs: 5_000,
        maxRetries: 2,
      })
      : await fetchImpl(url, init);
    const data = await readEnvelope<{ cookiePresent: boolean }>(response);
    return data.cookiePresent
      ? { ok: true }
      : { ok: false, reason: 'guest', status: 401, code: 'AUTH_REFRESH_MISSING' };
  } catch (error) {
    const status = errorStatus(error);
    const code = errorCode(error);
    if (status === 401 || status === 403 || code === 'AUTH_REFRESH_MISSING') {
      return { ok: false, reason: 'guest', status: status ?? 401, code };
    }
    return { ok: false, reason: 'network', error };
  }
}

/**
 * Cookie probe for Website bootstrap — never triggers refresh.
 * 401/403 / AUTH_REFRESH_MISSING → guest; network blips → network.
 */
export async function probeAuthV2Session(
  fetchImpl: AuthV2Fetch = fetch,
  apiBase = '',
): Promise<AuthV2SessionProbe> {
  try {
    const data = await getAuthV2Session(fetchImpl, apiBase);
    if (!data?.authenticated || !data?.cookiePresent) {
      return { ok: false, reason: 'guest', status: 401 };
    }
    return { ok: true, data };
  } catch (error) {
    const status = errorStatus(error);
    const code = errorCode(error);
    if (
      status === 401
      || status === 403
      || code === 'AUTH_REFRESH_MISSING'
      || code === 'AUTH_SESSION_EXPIRED'
      || code === 'AUTH_INVALID_TOKEN'
    ) {
      return { ok: false, reason: 'guest', status: status ?? 401, code };
    }
    if (
      (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError')
      || error instanceof TypeError
      || (status !== undefined && (status === 0 || status >= 500 || status === 408 || status === 429))
    ) {
      return { ok: false, reason: 'network', error };
    }
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (
        message.includes('failed to fetch')
        || message.includes('networkerror')
        || message.includes('aborted')
        || message.includes('timeout')
      ) {
        return { ok: false, reason: 'network', error };
      }
    }
    // Unknown auth failure → guest (never refresh).
    return { ok: false, reason: 'guest', status: status ?? 401, code };
  }
}
