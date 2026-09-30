import { Injectable } from '@nestjs/common';
import { TokenService } from '../auth-v2/token.service';
import { SessionService } from '../auth-v2/session.service';
import { AuthPlatformError } from '../auth-v2/auth-errors';

export type RealtimeAuthUser = {
  id: bigint;
  onixId: string;
  /** Carried from the session lookup so typing/read fan-out needs no extra user query. */
  displayName: string | null;
  isAdmin: boolean;
  sessionId: string;
};

@Injectable()
export class RealtimeAuthService {
  constructor(
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
  ) {}

  async authenticateAccessToken(accessToken: string): Promise<RealtimeAuthUser> {
    const raw = accessToken.trim();
    if (!raw) {
      throw new AuthPlatformError('AUTH_INVALID_TOKEN', 'Access token is missing.');
    }
    const claims = this.tokens.verifyAccessToken(raw);
    const { user, session } = await this.sessions.validateAccessClaims(claims);
    return {
      id: user.id,
      onixId: user.onixId,
      displayName: user.displayName ?? null,
      isAdmin: user.isAdmin,
      sessionId: session.id,
    };
  }
}
