import { Module } from '@nestjs/common';
import { AuthV2Module } from '../auth-v2/auth-v2.module';
import { EconomyModule } from '../economy/economy.module';
import { EscrowModule } from '../escrow.module';
import { RiskModule } from '../risk/risk.module';
import { SupportModule } from '../support.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminPlaneController } from './admin.controller';
import { AdminAccessGuard, AdminRoleGuard } from './admin.guard';
import { AdminSecurityService } from './admin-security.service';
import { AdminSessionService } from './admin-session.service';
import { AdminTokenService } from './admin-token.service';

@Module({
  imports: [AuthV2Module, EconomyModule, EscrowModule, RiskModule, SupportModule],
  controllers: [AdminAuthController, AdminPlaneController],
  providers: [
    AdminTokenService,
    AdminSessionService,
    AdminAuthService,
    AdminSecurityService,
    AdminAccessGuard,
    AdminRoleGuard,
  ],
  exports: [AdminSessionService, AdminAuthService, AdminSecurityService],
})
export class AdminModule {}
