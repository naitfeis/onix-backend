import WebApp from '@twa-dev/sdk';
import type { ApiEnvelope } from './contracts';

const TOKEN_KEY = 'onix.accessToken';
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.trim().replace(/\/+$/, '');

function apiUrl(path: string): string {
  console.log("API BASE =", API_BASE);
  if (!API_BASE) throw new Error('VITE_API_URL is not configured');
  return `${API_BASE}${path}`;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function getAccessToken(): string | null {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function setAccessToken(token: string): void {
  try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* Storage can be unavailable. */ }
}

function initData(): string {
  try {
    return WebApp.initData || '';
  } catch {
    return '';
  }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  const token = getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body) headers.set('Content-Type', 'application/json');

  const url = apiUrl(path);
  console.log("POST URL =", url);
  console.log("fetch() full URL =", url);
  console.log("FINAL REQUEST URL", url);
  const response = await fetch(url, { ...options, headers });
  let payload: ApiEnvelope<T> | undefined;
  try {
    payload = await response.json() as ApiEnvelope<T>;
  } catch {
    throw new ApiError('Сервер вернул некорректный ответ. Попробуйте ещё раз.', response.status);
  }
  if (!response.ok || !payload.success) {
    const detail = payload.error?.message;
    const message = Array.isArray(detail) ? detail.join(' ') : detail;
    throw new ApiError(message || payload.message || 'Не удалось выполнить действие. Повторите попытку.', response.status);
  }
  return payload.data;
}

interface AuthResult {
  accessToken: string;
  tokenType: 'Bearer';
}

export async function bootstrapAuth(): Promise<boolean> {
  console.log("bootstrapAuth started");
  const data = initData();
  console.log("initData =", data);
  if (!data) {
    console.log("initData is EMPTY");
    return false;
  }
  console.log("Calling telegram-mini endpoint");
  const result = await api.post<AuthResult>('/api/auth/telegram-mini', { initData: data });
  setAccessToken(result.accessToken);
  console.log("JWT received");
  return true;
}

export async function loginWithTelegram(payload: Record<string, string | number>): Promise<void> {
  console.log("Calling /telegram-login");
  const result = await api.post<AuthResult>('/api/auth/telegram-login', payload);
  setAccessToken(result.accessToken);
  console.log("JWT received");
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
