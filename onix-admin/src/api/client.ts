type ApiEnvelope<T> = { success: true; data: T } | { success: false; error: { code?: string; message: string } };

const TOKEN_KEY = 'onix.admin.accessToken';
let refreshPromise: Promise<string> | null = null;

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

async function parseResponse<T>(res: Response): Promise<T> {
  const payload = await res.json() as ApiEnvelope<T>;
  if (!res.ok || !payload || payload.success !== true) {
    const err = payload && 'error' in payload ? payload.error : { message: 'Request failed' };
    throw new AdminApiError(err.message || 'Request failed', res.status, err.code);
  }
  return payload.data;
}

async function refreshAdminAccess(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const res = await fetch('/api/admin/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      const data = await parseResponse<{ accessToken: string }>(res);
      setAdminToken(data.accessToken);
      return data.accessToken;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function adminApi<T>(
  path: string,
  init: RequestInit = {},
  retryAfterRefresh = true,
): Promise<T> {
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
  if (
    res.status === 401
    && retryAfterRefresh
    && !path.startsWith('/api/admin/auth/')
  ) {
    try {
      const accessToken = await refreshAdminAccess();
      const retryHeaders = new Headers(init.headers);
      retryHeaders.set('Accept', 'application/json');
      retryHeaders.set('Authorization', `Bearer ${accessToken}`);
      if (init.body) retryHeaders.set('Content-Type', 'application/json');
      return adminApi<T>(path, { ...init, headers: retryHeaders }, false);
    } catch {
      clearAdminToken();
    }
  }
  return parseResponse<T>(res);
}
