import {
  Body, Controller, Get, Header, NotFoundException, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { Public } from '../common';
import {
  AdminAccessGuard, AdminRoleGuard, AdminRoles, CurrentAdmin,
} from './admin.guard';
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
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SECURITY_ADMIN)
  @UseGuards(AdminRoleGuard)
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
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SECURITY_ADMIN, AdminRole.SUPPORT_ADMIN)
  @UseGuards(AdminRoleGuard)
  async user(
    @CurrentAdmin() admin: AdminActor,
    @Param('id') id: string,
  ) {
    const data = await this.security.getUserInvestigation(id);
    if (!data) throw new NotFoundException('РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РЅР°Р№РґРµРЅ.');
    await this.security.logAction(admin, 'ADMIN_VIEW_USER', {
      type: 'User',
      id: data.profile.id,
    });
    return data;
  }

  @Patch('users/:id/ban')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SECURITY_ADMIN)
  @UseGuards(AdminRoleGuard)
  banUser(@CurrentAdmin() admin: AdminActor, @Param('id') id: string, @Body() body: { reason: string; comment: string; durationDays?: number }) {
    return this.security.banUser(admin, id, body);
  }

  @Patch('users/:id/sell-ban')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SECURITY_ADMIN)
  @UseGuards(AdminRoleGuard)
  sellBanUser(@CurrentAdmin() admin: AdminActor, @Param('id') id: string, @Body() body: { comment: string; banned: boolean }) {
    return this.security.sellBanUser(admin, id, body);
  }

  @Patch('users/:id/role')
  @AdminRoles(AdminRole.SUPER_ADMIN)
  @UseGuards(AdminRoleGuard)
  setUserRole(@CurrentAdmin() admin: AdminActor, @Param('id') id: string, @Body() body: { role: string }) {
    return this.security.setUserRole(admin, id, body.role);
  }

  @Post('users/:id/balance')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE_ADMIN)
  @UseGuards(AdminRoleGuard)
  adjustUserBalance(@CurrentAdmin() admin: AdminActor, @Param('id') id: string, @Body() body: { amountCents: string; reason: string; idempotencyKey: string }) {
    return this.security.adjustUserBalance(admin, id, body);
  }
  @Get('orders')
  @Header('Cache-Control', 'no-store')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SECURITY_ADMIN, AdminRole.SUPPORT_ADMIN, AdminRole.FINANCE_ADMIN)
  @UseGuards(AdminRoleGuard)
  async orders(
    @CurrentAdmin() admin: AdminActor,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    const orders = await this.security.listOrders({ limit: limit ? Number(limit) : 50, status });
    await this.security.logAction(admin, 'ADMIN_LIST_ORDERS', { metadata: { count: orders.length, status: status ?? 'ALL' } });
    return { orders };
  }

  @Get('orders/:id')
  @Header('Cache-Control', 'no-store')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SECURITY_ADMIN, AdminRole.SUPPORT_ADMIN, AdminRole.FINANCE_ADMIN)
  @UseGuards(AdminRoleGuard)
  async order(@CurrentAdmin() admin: AdminActor, @Param('id') id: string) {
    const order = await this.security.getOrderInvestigation(id);
    if (!order) throw new NotFoundException('Сделка не найдена.');
    await this.security.logAction(admin, 'ADMIN_VIEW_ORDER', { type: 'Order', id: order.id });
    return order;
  }

  @Get('audit-log')
  @Header('Cache-Control', 'no-store')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SECURITY_ADMIN, AdminRole.SUPPORT_ADMIN, AdminRole.FINANCE_ADMIN)
  @UseGuards(AdminRoleGuard)
  async auditLog(@CurrentAdmin() admin: AdminActor, @Query('limit') limit?: string, @Query('action') action?: string) {
    const logs = await this.security.listAdminAudit({ limit: limit ? Number(limit) : 100, action });
    await this.security.logAction(admin, 'ADMIN_LIST_AUDIT_LOG', { metadata: { count: logs.length, action: action ?? 'ALL' } });
    return { logs };
  }
  @Get('withdrawals')
  @Header('Cache-Control', 'no-store')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SECURITY_ADMIN, AdminRole.FINANCE_ADMIN)
  @UseGuards(AdminRoleGuard)
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
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SECURITY_ADMIN)
  @UseGuards(AdminRoleGuard)
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
