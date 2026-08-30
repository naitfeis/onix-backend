import { Module, type Type } from '@nestjs/common';
import { AvatarsModule } from '../avatars/avatars.module';
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
import { RiskModule } from '../risk/risk.module';
import { SessionService } from './session.service';
import { DeviceTrustService } from './device-trust.service';
import { SigningKeyService } from './signing-key.service';
import { TelegramLoginVerifier } from './telegram-login.verifier';
import { GoogleLoginVerifier } from './google-login.verifier';
import { TokenService } from './token.service';
import { debugEndpointsEnabled } from '../debug-endpoints';
import { CoordinationModule } from '../coordination/coordination.module';

const debugControllers: Type<unknown>[] = debugEndpointsEnabled()
  ? [DebugSessionController, SessionProbeController]
  : [];

/**
 * Website auth v2 (Phase 2 complete surface).
 * USE_NEW_AUTH defaults to false — legacy Mini App /telegram-* remain the production default client path.
 * Phase 3.1: DualAccessService enables AUTH_ACCEPT_V2_ACCESS for global AuthGuard (still default off).
 * Phase 3.2: AuthOrchestrator.dualIssueSessionAfterLegacyLogin behind AUTH_DUAL_ISSUE_SESSION (default off).
 * Phase 3.3: AuthRolloutService canary % + mode ladder (USE_NEW_AUTH stays false until ops gate).
 */
@Module({
  imports: [AvatarsModule, CoordinationModule, RiskModule],
  controllers: [AuthV2Controller, ...debugControllers],
  providers: [
    { provide: SECRETS_PROVIDER, useClass: EnvSecretsProvider },
    { provide: AUTH_EVENT_PUBLISHER, useValue: new AuthEventPublisher() },
    SigningKeyService,
    TokenService,
    DeviceTrustService,
    SessionService,
    DualAccessService,
    AuthRolloutService,
    RiskScoreService,
    IdentityService,
    TelegramLoginVerifier,
    GoogleLoginVerifier,
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
    DeviceTrustService,
    DualAccessService,
    AuthRolloutService,
    AuthOrchestrator,
    AuthV2Guard,
    RolesGuard,
    PermissionGuard,
    RbacService,
    RiskScoreService,
    RiskModule,
    SECRETS_PROVIDER,
    AUTH_EVENT_PUBLISHER,
  ],
})
export class AuthV2Module {}
