/**
 * Google Sign-In without GIS popup. Full-page OAuth id_token.
 * Production always uses www + `/auth/google` so apex / trailing-slash Console
 * entries cannot cause redirect_uri_mismatch. Add this URI in Google Console:
 *   https://www.onixtg.shop/auth/google
 * Also add Authorized JavaScript origin: https://www.onixtg.shop
 */

export const GOOGLE_OAUTH_CALLBACK_PATH = '/auth/google';
export const PRODUCTION_GOOGLE_REDIRECT_URI = 'https://www.onixtg.shop/auth/google';

const STATE_KEY = 'onix_google_oauth_state';
const NONCE_KEY = 'onix_google_oauth_nonce';
const INTENT_KEY = 'onix_google_oauth_intent';

export type GoogleOAuthIntent = 'login' | 'link';

export type GoogleOAuthReturn =
  | { ok: true; idToken: string }
  | { ok: false; error: string }
  | null;

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function googleRedirectUri(origin: string, override?: string | null): string {
  const configured = override?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const base = origin.replace(/\/+$/, '');
  if (base === 'https://www.onixtg.shop' || base === 'https://onixtg.shop') {
    return PRODUCTION_GOOGLE_REDIRECT_URI;
  }
  return `${base}${GOOGLE_OAUTH_CALLBACK_PATH}`;
}

export function buildGoogleOAuthUrl(
  clientId: string,
  origin: string,
  state: string,
  nonce: string,
  redirectOverride?: string | null,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleRedirectUri(origin, redirectOverride),
    response_type: 'id_token',
    scope: 'openid email profile',
    nonce,
    state,
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function startGoogleOAuth(
  clientId: string,
  redirectOverride?: string | null,
  options?: { intent?: GoogleOAuthIntent },
): void {
  const state = randomToken();
  const nonce = randomToken();
  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(NONCE_KEY, nonce);
  sessionStorage.setItem(INTENT_KEY, options?.intent === 'link' ? 'link' : 'login');
  window.location.assign(
    buildGoogleOAuthUrl(clientId, window.location.origin, state, nonce, redirectOverride),
  );
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
  const linking = sessionStorage.getItem(INTENT_KEY) === 'link';
  window.history.replaceState(null, '', result.ok ? '/' : (linking ? '/' : '/?auth_error=google'));
  return result;
}

export function consumeGoogleOAuthIntent(): GoogleOAuthIntent {
  if (typeof window === 'undefined') return 'login';
  const raw = sessionStorage.getItem(INTENT_KEY);
  sessionStorage.removeItem(INTENT_KEY);
  return raw === 'link' ? 'link' : 'login';
}
