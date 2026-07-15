import WebApp from '@twa-dev/sdk';
import { buildApiUrl, resolveApiBase, shouldIncludeCredentials } from '../auth/apiConfig';
import { peekSharedAuthManager } from '../auth/sharedAuthManager';
import type { ApiEnvelope } from './contracts';

const TOKEN_KEY = 'onix.accessToken';

function apiUrl(path: string): string {
  return buildApiUrl(path, resolveApiBase());
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;
  readonly field?: string;
  readonly fieldError?: string;

  constructor(
    message: string,
    status: number,
    opts?: { code?: string; details?: unknown; field?: string; fieldError?: string },
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = opts?.code;
    this.details = opts?.details;
    this.field = opts?.field;
    this.fieldError = opts?.fieldError;
  }
}

/** Legacy Mini App / widget sessionStorage token. */
export function getAccessToken(): string | null {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}

/**
 * Bearer for API calls: AuthManager memory (Website bot / V2) wins when present,
 * otherwise legacy sessionStorage (Mini App). Does not create AuthManager.
 */
export function getBearerToken(): string | null {
  const memory = peekSharedAuthManager()?.getAccessToken() ?? null;
  if (memory) return memory;
  return getAccessToken();
}

export function setAccessToken(token: string): void {
  try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* Storage can be unavailable. */ }
}

export function clearAccessToken(): void {
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* Storage can be unavailable. */ }
}

function initData(): string {
  try {
    return WebApp.initData || '';
  } catch {
    return '';
  }
}

async function executeApiRequest<T>(path: string, options: RequestInit, token: string | null): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body) headers.set('Content-Type', 'application/json');

  const url = apiUrl(path);
  const response = await fetch(url, {
    ...options,
    headers,
    credentials: shouldIncludeCredentials() ? 'include' : (options.credentials ?? 'same-origin'),
  });
  let payload: ApiEnvelope<T> | undefined;
  try {
    payload = await response.json() as ApiEnvelope<T>;
  } catch {
    throw new ApiError('Сервер вернул некорректный ответ. Попробуйте ещё раз.', response.status);
  }
  if (!response.ok || !payload.success) {
    const detail = payload.error?.message;
    const message = Array.isArray(detail) ? detail.join(' ') : detail;
    const errObj = payload.error as { code?: string; details?: unknown; field?: string; error?: string } | undefined;
    const field = typeof errObj?.field === 'string' ? errObj.field : undefined;
    const fieldError = typeof errObj?.error === 'string' ? errObj.error : undefined;
    throw new ApiError(
      (field && fieldError ? `${field}: ${fieldError}` : undefined)
        || message
        || payload.message
        || 'Не удалось выполнить действие. Повторите попытку.',
      response.status,
      {
        code: errObj?.code,
        details: errObj?.details,
        field,
        fieldError,
      },
    );
  }
  return payload.data;
}

/** In-flight GET dedupe — one network request, many subscribers (bootstrap / StrictMode). */
const inflightGets = new Map<string, Promise<unknown>>();

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const dedupe = method === 'GET' && !options.signal;
  const run = async (): Promise<T> => {
    const manager = peekSharedAuthManager();
    // Website Auth V2 / bot session: single-flight refresh + one 401 retry via AuthManager.
    if (manager?.getAccessToken()) {
      return manager.withAccessToken((accessToken) => executeApiRequest<T>(path, options, accessToken));
    }
    return executeApiRequest<T>(path, options, getAccessToken());
  };
  if (!dedupe) return run();
  const existing = inflightGets.get(path);
  if (existing) return existing as Promise<T>;
  const promise = run().finally(() => {
    if (inflightGets.get(path) === promise) inflightGets.delete(path);
  });
  inflightGets.set(path, promise);
  return promise;
}

interface AuthResult {
  accessToken: string;
  tokenType: 'Bearer';
}

export async function bootstrapAuth(): Promise<boolean> {
  const data = initData();
  if (!data) {
    return false;
  }
  const result = await api.post<AuthResult>('/api/auth/telegram-mini', { initData: data });
  setAccessToken(result.accessToken);
  return true;
}

export async function loginWithTelegram(payload: Record<string, string | number>): Promise<void> {
  const result = await api.post<AuthResult>('/api/auth/telegram-login', payload);
  setAccessToken(result.accessToken);
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => apiRequest<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  }),
  patch: <T>(path: string, body: unknown) => apiRequest<T>(path, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
};

export function money(cents: string): string {
  const value = Number(cents);
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 2,
  }).format(value / 100);
}

export function friendlyError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof DOMException && error.name === 'AbortError') return '';
  return 'Нет связи с ONIX. Проверьте интернет и повторите попытку.';
}
