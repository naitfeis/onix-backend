type ApiEnvelope<T> = { success: true; data: T } | { success: false; error: { code?: string; message: string } };

const TOKEN_KEY = 'onix.admin.accessToken';

export function getAdminToken(): string | null {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function setAdminToken(token: string): void {
  try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* ignore */ }
}

export function clearAdminToken(): void {
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

export class AdminApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function adminApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  const token = getAdminToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body) headers.set('Content-Type', 'application/json');

  const res = await fetch(path, {
    ...init,
    headers,
    credentials: 'include',
  });
  const payload = await res.json() as ApiEnvelope<T>;
  if (!res.ok || !payload || payload.success !== true) {
    const err = payload && 'error' in payload ? payload.error : { message: 'Request failed' };
    throw new AdminApiError(err.message || 'Request failed', res.status, err.code);
  }
  return payload.data;
}
