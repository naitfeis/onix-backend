import { Module } from '@nestjs/common';
import { AuthOrchestrator } from './auth-orchestrator.service';
import { AUTH_EVENT_PUBLISHER, AuthEventPublisher } from './auth-events';
import { AuthV2Controller } from './auth-v2.controller';
import { DebugSessionController } from './debug-session.controller';
import { SessionProbeController } from './session-probe.controller';
import { AuthV2Guard, PermissionGuard, RolesGuard } from './auth-v2.guards';
import { DualAccessService } from './dual-access.service';
import { AuthRolloutService } from './auth-rollout.service';
import { IdentityService } from './identity.service';
import { RbacService } from './rbac.service';
import { SECRETS_PROVIDER, EnvSecretsProvider } from './secrets.provider';
import { RiskScoreService } from '../risk-score.service';
import { SessionService } from './session.service';
import { SigningKeyService } from './signing-key.service';
import { TelegramLoginVerifier } from './telegram-login.verifier';
import { TokenService } from './token.service';

/**
 * Website auth v2 (Phase 2 complete surface).
 * USE_NEW_AUTH defaults to false — legacy Mini App /telegram-* remain the production default client path.
 * Phase 3.1: DualAccessService enables AUTH_ACCEPT_V2_ACCESS for global AuthGuard (still default off).
 * Phase 3.2: AuthOrchestrator.dualIssueSessionAfterLegacyLogin behind AUTH_DUAL_ISSUE_SESSION (default off).
 * Phase 3.3: AuthRolloutService canary % + mode ladder (USE_NEW_AUTH stays false until ops gate).
 */
@Module({
  controllers: [AuthV2Controller, DebugSessionController, SessionProbeController],
  providers: [
    { provide: SECRETS_PROVIDER, useClass: EnvSecretsProvider },
    { provide: AUTH_EVENT_PUBLISHER, useValue: new AuthEventPublisher() },
    SigningKeyService,
    TokenService,
    SessionService,
    DualAccessService,
    AuthRolloutService,
    RiskScoreService,
    IdentityService,
    TelegramLoginVerifier,
    AuthOrchestrator,
    RbacService,
    AuthV2Guard,
    RolesGuard,
    PermissionGuard,
  ],
  exports: [
    TokenService,
    SigningKeyService,
    SessionService,
    DualAccessService,
    AuthRolloutService,
    AuthOrchestrator,
    AuthV2Guard,
    RolesGuard,
    PermissionGuard,
    RbacService,
    RiskScoreService,
    SECRETS_PROVIDER,
    AUTH_EVENT_PUBLISHER,
  ],
})
export class AuthV2Module {}
