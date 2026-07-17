import { buildApiUrl } from './apiConfig';
import type { ApiEnvelope } from '../api/contracts';
import { resilientFetch } from '../api/fetchResilience';

export type RefreshSuccess = {
  accessToken: string;
  expiresIn: number;
};

export class RefreshError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'RefreshError';
    this.status = status;
    this.code = code;
  }
}

/** Server rejected the refresh cookie / session — safe to treat as logged out. */
export function isDefinitiveAuthRefreshFailure(error: unknown): boolean {
  if (!(error instanceof RefreshError)) return false;
  if (error.code === 'AUTH_NETWORK_TRANSIENT') return false;
  if (error.status === 401 || error.status === 403) return true;
  const code = error.code ?? '';
  return (
    code === 'AUTH_REFRESH_MISSING'
    || code === 'AUTH_REFRESH_REUSED'
    || code === 'AUTH_SESSION_REVOKED'
    || code === 'AUTH_SESSION_EXPIRED'
    || code === 'AUTH_INVALID_TOKEN'
    || code === 'AUTH_ACCOUNT_LOCKED'
  );
}

/** Timeout / Failed to fetch / 5xx — cookie may still be valid; do not logout. */
export function isTransientRefreshFailure(error: unknown): boolean {
  if (error instanceof RefreshError) {
    if (error.code === 'AUTH_NETWORK_TRANSIENT') return true;
    if (error.status === 0 || error.status >= 500) return true;
    if (error.status === 408 || error.status === 429) return true;
    return false;
  }
  if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }
  if (error instanceof TypeError) return true;
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('failed to fetch')
      || message.includes('networkerror')
      || message.includes('aborted')
      || message.includes('timeout')
    );
  }
  return false;
}

export type RefreshTransport = (input: {
  url: string;
  init: RequestInit;
}) => Promise<Response>;

/**
 * POST /api/v2/auth/refresh — cookie + CSRF.
 * Used by AuthManager; injectable for tests / mocks.
 */
export async function postAuthV2Refresh(
  transport: RefreshTransport = defaultTransport,
): Promise<RefreshSuccess> {
  const url = buildApiUrl('/api/v2/auth/refresh');
  const headers = new Headers({
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-ONIX-CSRF': '1',
  });

  let response: Response;
  try {
    response = await transport({
      url,
      init: {
        method: 'POST',
        headers,
        // Refresh cookie is HttpOnly; Auth V2 always needs credentials on this call.
        credentials: 'include',
        body: '{}',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error during refresh.';
    throw new RefreshError(message, 0, 'AUTH_NETWORK_TRANSIENT');
  }

  let payload: ApiEnvelope<RefreshSuccess & Record<string, unknown>> | undefined;
  try {
    payload = await response.json() as ApiEnvelope<RefreshSuccess & Record<string, unknown>>;
  } catch {
    if (response.status >= 500 || response.status === 0) {
      throw new RefreshError('Refresh returned a non-JSON body.', response.status, 'AUTH_NETWORK_TRANSIENT');
    }
    throw new RefreshError('Refresh returned a non-JSON body.', response.status);
  }

  if (!response.ok || !payload.success) {
    const code = payload.error?.code;
    const detail = payload.error?.message;
    const message = Array.isArray(detail) ? detail.join(' ') : detail;
    throw new RefreshError(
      message || payload.message || 'Refresh failed.',
      response.status,
      response.status >= 500 ? (code ?? 'AUTH_NETWORK_TRANSIENT') : code,
    );
  }

  const accessToken = payload.data?.accessToken;
  const expiresIn = Number(payload.data?.expiresIn ?? 900);
  if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new RefreshError('Refresh response missing accessToken/expiresIn.', response.status);
  }

  return { accessToken, expiresIn };
}

/** Cookie refresh on RU → CF → Vercel → Render; keep cookie, never treat timeout as logout. */
export const AUTH_REFRESH_TIMEOUT_MS = 18_000;

async function defaultTransport({ url, init }: { url: string; init: RequestInit }): Promise<Response> {
  // Refresh is cookie+CSRF same-origin; allow more time on slow RU paths.
  // Retry connection-reset style failures (not full-timeout aborts) — keeps cookie.
  return resilientFetch(url, { ...init, timeoutMs: AUTH_REFRESH_TIMEOUT_MS, maxRetries: 3 });
}
