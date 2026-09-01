import { AuthPlatformError } from './auth-errors';

const GOOGLE_TOKENINFO = 'https://oauth2.googleapis.com/tokeninfo';
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

export type VerifiedGoogleIdentity = {
  sub: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
  givenName?: string;
  familyName?: string;
  picture?: string;
};

export class GoogleLoginVerifier {
  async verify(idToken: string): Promise<VerifiedGoogleIdentity> {
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    if (!clientId) {
      throw new AuthPlatformError('AUTH_INTERNAL', 'Google login is not configured.');
    }
    const token = idToken.trim();
    if (!token || token.length > 4096) {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Google token is invalid.');
    }
    // POST keeps the JWT out of access logs / proxy URLs (GET ?id_token= leaked).
    const response = await fetch(GOOGLE_TOKENINFO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ id_token: token }),
    });
    if (!response.ok) {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Google token is invalid.');
    }
    const body = await response.json() as {
      aud?: string;
      sub?: string;
      iss?: string;
      exp?: string;
      email?: string;
      email_verified?: string | boolean;
      name?: string;
      given_name?: string;
      family_name?: string;
      picture?: string;
    };
    if (body.aud !== clientId || !body.sub) {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Google token is invalid.');
    }
    if (!body.iss || !GOOGLE_ISSUERS.has(body.iss)) {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Google token is invalid.');
    }
    const exp = Number(body.exp);
    if (!Number.isFinite(exp) || exp * 1000 <= Date.now()) {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Google token is invalid.');
    }
    const verified = body.email_verified === true || body.email_verified === 'true';
    if (body.email && !verified) {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Google token is invalid.');
    }
    const givenName = clipName(body.given_name);
    const familyName = clipName(body.family_name);
    const composed = [givenName, familyName].filter(Boolean).join(' ');
    const name = clipName(body.name) ?? (composed || undefined);
    const picture = clipPicture(body.picture);
    return {
      sub: body.sub,
      email: body.email,
      emailVerified: verified,
      name,
      givenName,
      familyName,
      picture,
    };
  }
}

function clipName(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  return text.slice(0, 120);
}

function clipPicture(value: string | undefined): string | undefined {
  const url = value?.trim();
  if (!url || url.length > 500) return undefined;
  return url;
}
