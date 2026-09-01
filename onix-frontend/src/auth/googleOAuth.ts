/**
 * Google Sign-In without GIS popup. Full-page OAuth id_token.
 * Redirect URI is a real path so Google Console does not strip a trailing slash
 * (origin `/` is stored as `https://www.onixtg.shop` → redirect_uri_mismatch).
 * Add Authorized redirect URI exactly: `https://www.onixtg.shop/auth/google`
 */

export const GOOGLE_OAUTH_CALLBACK_PATH = '/auth/google';

const STATE_KEY = 'onix_google_oauth_state';
const NONCE_KEY = 'onix_google_oauth_nonce';

export type GoogleOAuthReturn =
  | { ok: true; idToken: string }
  | { ok: false; error: string }
  | null;

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function googleRedirectUri(origin: string): string {
  const base = origin.replace(/\/+$/, '');
  return `${base}${GOOGLE_OAUTH_CALLBACK_PATH}`;
}

export function buildGoogleOAuthUrl(
  clientId: string,
  origin: string,
  state: string,
  nonce: string,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleRedirectUri(origin),
    response_type: 'id_token',
    scope: 'openid email profile',
    nonce,
    state,
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function startGoogleOAuth(clientId: string): void {
  const state = randomToken();
  const nonce = randomToken();
  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(NONCE_KEY, nonce);
  window.location.assign(buildGoogleOAuthUrl(clientId, window.location.origin, state, nonce));
}

function decodeJwtPayload(idToken: string): { nonce?: string } | null {
  const part = idToken.split('.')[1];
  if (!part) return null;
  try {
    const padded = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4);
    return JSON.parse(atob(padded)) as { nonce?: string };
  } catch {
    return null;
  }
}

/** Pure parse — tests do not need sessionStorage / history. */
export function interpretGoogleOAuthReturn(
  href: string,
  expectedState: string | null,
  expectedNonce: string | null,
): GoogleOAuthReturn {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  const hashParams = new URLSearchParams(hash);
  const idToken = hashParams.get('id_token') ?? url.searchParams.get('id_token');
  const state = hashParams.get('state') ?? url.searchParams.get('state');
  const error = hashParams.get('error') ?? url.searchParams.get('error');
  if (!idToken && !error) return null;
  if (error) {
    return { ok: false, error };
  }
  if (!idToken) return { ok: false, error: 'missing_token' };
  if (!expectedState || state !== expectedState) {
    return { ok: false, error: 'state_mismatch' };
  }
  if (expectedNonce) {
    const payload = decodeJwtPayload(idToken);
    if (!payload?.nonce || payload.nonce !== expectedNonce) {
      return { ok: false, error: 'nonce_mismatch' };
    }
  }
  return { ok: true, idToken };
}

export function consumeGoogleOAuthRedirect(): GoogleOAuthReturn {
  if (typeof window === 'undefined') return null;
  const result = interpretGoogleOAuthReturn(
    window.location.href,
    sessionStorage.getItem(STATE_KEY),
    sessionStorage.getItem(NONCE_KEY),
  );
  if (result === null) return null;
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(NONCE_KEY);
  window.history.replaceState(null, '', result.ok ? '/' : '/?auth_error=google');
  return result;
}
