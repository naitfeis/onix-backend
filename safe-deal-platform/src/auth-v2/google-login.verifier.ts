import { AuthPlatformError } from './auth-errors';

export type VerifiedGoogleIdentity = {
  sub: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
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
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`,
    );
    if (!response.ok) {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Google token is invalid.');
    }
    const body = await response.json() as {
      aud?: string;
      sub?: string;
      email?: string;
      email_verified?: string | boolean;
      name?: string;
      picture?: string;
    };
    if (body.aud !== clientId || !body.sub) {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Google token is invalid.');
    }
    const verified = body.email_verified === true || body.email_verified === 'true';
    return {
      sub: body.sub,
      email: body.email,
      emailVerified: verified,
      name: body.name,
      picture: body.picture,
    };
  }
}
