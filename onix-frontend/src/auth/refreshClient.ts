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

  const response = await transport({
    url,
    init: {
      method: 'POST',
      headers,
      // Refresh cookie is HttpOnly; Auth V2 always needs credentials on this call.
      credentials: 'include',
      body: '{}',
    },
  });

  let payload: ApiEnvelope<RefreshSuccess & Record<string, unknown>> | undefined;
  try {
    payload = await response.json() as ApiEnvelope<RefreshSuccess & Record<string, unknown>>;
  } catch {
    throw new RefreshError('Refresh returned a non-JSON body.', response.status);
  }

  if (!response.ok || !payload.success) {
    const code = payload.error?.code;
    const detail = payload.error?.message;
    const message = Array.isArray(detail) ? detail.join(' ') : detail;
    throw new RefreshError(
      message || payload.message || 'Refresh failed.',
      response.status,
      code,
    );
  }

  const accessToken = payload.data?.accessToken;
  const expiresIn = Number(payload.data?.expiresIn ?? 900);
  if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new RefreshError('Refresh response missing accessToken/expiresIn.', response.status);
  }

  return { accessToken, expiresIn };
}

async function defaultTransport({ url, init }: { url: string; init: RequestInit }): Promise<Response> {
  // Refresh is cookie+CSRF same-origin; allow a bit more time on slow RU paths.
  // No timeout-retry (see resilientFetch) — avoids false "8s then 201".
  return resilientFetch(url, { ...init, timeoutMs: 12_000, maxRetries: 1 });
}
