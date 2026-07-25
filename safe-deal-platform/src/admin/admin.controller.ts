import {
  Controller, Get, Header, NotFoundException, Param, Query, UseGuards,
} from '@nestjs/common';
import { Public } from '../common';
import { AdminAccessGuard, CurrentAdmin } from './admin.guard';
import type { AdminActor } from './admin-session.service';
import { AdminSecurityService } from './admin-security.service';

/**
 * Slice 6 Security Operations Console APIs.
 * Customer JWT rejected by AdminAccessGuard (typ must be admin_access).
 * @Public() skips global customer AuthGuard.
 */
@Controller('admin')
@Public()
@UseGuards(AdminAccessGuard)
export class AdminPlaneController {
  constructor(private readonly security: AdminSecurityService) {}

  @Get('me')
  @Header('Cache-Control', 'no-store')
  me(@CurrentAdmin() admin: AdminActor) {
    return {
      id: admin.id.toString(),
      email: admin.email,
      role: admin.role,
      sessionId: admin.sessionId,
    };
  }

  @Get('dashboard')
  @Header('Cache-Control', 'no-store')
  dashboard() {
    return this.security.dashboard();
  }

  @Get('security-flags')
  @Header('Cache-Control', 'no-store')
  async securityFlags(
    @CurrentAdmin() admin: AdminActor,
    @Query('limit') limit?: string,
  ) {
    const flags = await this.security.listSecurityFlags({
      limit: limit ? Number(limit) : 50,
    });
    await this.security.logAction(admin, 'ADMIN_LIST_SECURITY_FLAGS', {
      metadata: { count: flags.length },
    });
    return { flags };
  }

  @Get('users/:id')
  @Header('Cache-Control', 'no-store')
  async user(
    @CurrentAdmin() admin: AdminActor,
    @Param('id') id: string,
  ) {
    const data = await this.security.getUserInvestigation(id);
    if (!data) throw new NotFoundException('Пользователь не найден.');
    await this.security.logAction(admin, 'ADMIN_VIEW_USER', {
      type: 'User',
      id: data.profile.id,
    });
    return data;
  }

  @Get('withdrawals')
  @Header('Cache-Control', 'no-store')
  async withdrawals(
    @CurrentAdmin() admin: AdminActor,
    @Query('limit') limit?: string,
  ) {
    const rows = await this.security.listWithdrawals({
      limit: limit ? Number(limit) : 50,
    });
    await this.security.logAction(admin, 'ADMIN_LIST_WITHDRAWALS', {
      metadata: { count: rows.length },
    });
    return { withdrawals: rows };
  }

  @Get('risk/events')
  @Header('Cache-Control', 'no-store')
  async riskEvents(
    @CurrentAdmin() admin: AdminActor,
    @Query('limit') limit?: string,
  ) {
    const events = await this.security.listRiskEvents({
      limit: limit ? Number(limit) : 50,
    });
    await this.security.logAction(admin, 'ADMIN_LIST_RISK_EVENTS', {
      metadata: { count: events.length },
    });
    return { events };
  }
}
