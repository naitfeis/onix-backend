import {
  Body, Controller, Delete, Get, Header, NotFoundException, Param, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEmail, IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Max, Min,
} from 'class-validator';
import type { Request } from 'express';
import { Public } from '../common';
import { resolveClientIp } from '../http/client-ip';
import { parseAdminIpAllowlist } from './admin-ip-allowlist';
import { AdminAuthService } from './admin-auth.service';
import {
  AdminAccessGuard, AdminRoleGuard, AdminRoles, CurrentAdmin,
} from './admin.guard';
import type { AdminActor } from './admin-session.service';
import { AdminSecurityService } from './admin-security.service';
import { SupportCenterService } from '../support-center.service';

class WipeUserDto {
  @IsString() @Length(1, 40) confirmOnixId!: string;
  @IsString() @Length(1, 1000) reason!: string;
}

class UnlinkIdentityDto {
  @IsIn(['TELEGRAM', 'GOOGLE']) provider!: 'TELEGRAM' | 'GOOGLE';
  @IsOptional() @IsString() @Length(1, 40) confirmOnixId?: string;
  @IsOptional() @IsString() @Length(1, 1000) reason?: string;
}

class GrantProDto {
  @IsOptional() @IsISO8601() endsAt?: string;
}

class CreateManualPaymentDto {
  @IsIn(['MAIN', 'DEPOSIT']) wallet!: 'MAIN' | 'DEPOSIT';
  @Type(() => Number) @IsInt() @Min(100) @Max(50_000_000) amountCents!: number;
  @IsString() @Length(16, 100) idempotencyKey!: string;
}

class CreateStaffDto {
  @IsEmail() @Length(3, 191) email!: string;
  @IsOptional() @IsString() @Length(12, 200) password?: string;
  @IsIn(['SUPER_ADMIN', 'SECURITY_ADMIN', 'SUPPORT_ADMIN', 'FINANCE_ADMIN']) role!: AdminRole;
  @IsOptional() @IsString() @Length(5, 20) telegramId?: string;
}

class ResetStaffPasswordDto {
  @IsOptional() @IsString() @Length(12, 200) password?: string;
}

/**
 * Slice 6 Security Operations Console APIs.
 * Customer JWT rejected by AdminAccessGuard (typ must be admin_access).
 * @Public() skips global customer AuthGuard.
 */
@Controller('admin')
@Public()
@UseGuards(AdminAccessGuard)
export class AdminPlaneController {
  constructor(
    private readonly security: AdminSecurityService,
    private readonly tickets: SupportCenterService,
    private readonly auth: AdminAuthService,
  ) {}

  @Get('me')
  @Header('Cache-Control', 'no-store')
  me(@CurrentAdmin() admin: AdminActor, @Req() req: Request) {
    const allowlist = parseAdminIpAllowlist();
    return {
      id: admin.id.toString(),
      email: admin.email,
      role: admin.role,
      sessionId: admin.sessionId,
      clientIp: resolveClientIp(req),
      ipAllowlistConfigured: Boolean(allowlist),
    };
  }

  @Get('staff')
  @Header('Cache-Control', 'no-store')
  @AdminRoles(AdminRole.SUPER_ADMIN)
  @UseGuards(AdminRoleGuard)
  async staffList(@CurrentAdmin() admin: AdminActor) {
    const staff = await this.auth.listStaff();
    await this.security.logAction(admin, 'ADMIN_LIST_STAFF', { metadata: { count: staff.length } });
    return { staff };
  }

  @Post('staff')
  @AdminRoles(AdminRole.SUPER_ADMIN)
  @UseGuards(AdminRoleGuard)
  async staffCreate(@CurrentAdmin() admin: AdminActor, @Body() body: CreateStaffDto) {
    const created = await this.auth.createStaff(body);
    await this.security.logAction(admin, 'ADMIN_CREATE_STAFF', {
      metadata: { email: created.email, role: created.role },
    });
    return created;
  }

  @Post('staff/:id/password')
  @AdminRoles(AdminRole.SUPER_ADMIN)
  @UseGuards(AdminRoleGuard)
  async staffResetPassword(
    @CurrentAdmin() admin: AdminActor,
    @Param('id') id: string,
    @Body() body: ResetStaffPasswordDto,
  ) {
    const updated = await this.auth.resetStaffPassword(id, body.password);
    await this.security.logAction(admin, 'ADMIN_RESET_STAFF_PASSWORD', {
      metadata: { email: updated.email },
    });
    return updated;
  }

  @Delete('staff/:id')
  @AdminRoles(AdminRole.SUPER_ADMIN)
  @UseGuards(AdminRoleGuard)
  async staffDelete(@CurrentAdmin() admin: AdminActor, @Param('id') id: string) {
    const result = await this.auth.deleteStaff(admin.id, id);
    await this.security.logAction(admin, 'ADMIN_DELETE_STAFF', { metadata: { id } });
    return result;
  }

  @Get('dashboard')
  @Header('Cache-Control', 'no-store')
  dashboard() {
    return this.security.dashboard();
  }

  @Get('users')
  @Header('Cache-Control', 'no-store')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SECURITY_ADMIN, AdminRole.SUPPORT_ADMIN)
  @UseGuards(AdminRoleGuard)
  async users(
    @CurrentAdmin() admin: AdminActor,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    const users = await this.security.listUsers({ q, limit: limit ? Number(limit) : 50 });
    await this.security.logAction(admin, 'ADMIN_LIST_USERS', { metadata: { count: users.length, q: q ?? null } });
    return { users };
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
    if (!data) throw new NotFoundException('Пользователь не найден.');
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

  @Patch('users/:id/unban')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SECURITY_ADMIN)
  @UseGuards(AdminRoleGuard)
  unbanUser(@CurrentAdmin() admin: AdminActor, @Param('id') id: string, @Body() body: { comment?: string }) {
    return this.security.unbanUser(admin, id, body.comment);
  }

  @Delete('users/:id')
  @AdminRoles(AdminRole.SUPER_ADMIN)
  @UseGuards(AdminRoleGuard)
  wipeUser(
    @CurrentAdmin() admin: AdminActor,
    @Param('id') id: string,
    @Body() body: WipeUserDto,
  ) {
    return this.security.wipeUser(admin, id, body);
  }

  @Post('users/:id/identities/unlink')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SECURITY_ADMIN)
  @UseGuards(AdminRoleGuard)
  unlinkIdentity(
    @CurrentAdmin() admin: AdminActor,
    @Param('id') id: string,
    @Body() body: UnlinkIdentityDto,
  ) {
    return this.security.unlinkIdentity(admin, id, body);
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

  @Patch('users/:id/status')
  @AdminRoles(AdminRole.SUPER_ADMIN)
  @UseGuards(AdminRoleGuard)
  setUserStatus(@CurrentAdmin() admin: AdminActor, @Param('id') id: string, @Body() body: { status: string }) {
    return this.security.setUserStatus(admin, id, body.status);
  }

  @Post('users/:id/balance')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE_ADMIN)
  @UseGuards(AdminRoleGuard)
  adjustUserBalance(@CurrentAdmin() admin: AdminActor, @Param('id') id: string, @Body() body: { amountCents: string; reason: string; idempotencyKey: string }) {
    return this.security.adjustUserBalance(admin, id, body);
  }

  @Post('users/:id/pro/grant')
  @AdminRoles(AdminRole.SUPER_ADMIN)
  @UseGuards(AdminRoleGuard)
  grantPro(@CurrentAdmin() admin: AdminActor, @Param('id') id: string, @Body() body: GrantProDto) {
    return this.security.grantPro(admin, id, body.endsAt);
  }

  @Post('users/:id/pro/revoke')
  @AdminRoles(AdminRole.SUPER_ADMIN)
  @UseGuards(AdminRoleGuard)
  revokePro(@CurrentAdmin() admin: AdminActor, @Param('id') id: string) {
    return this.security.revokePro(admin, id);
  }

  @Post('users/:id/payments/manual')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE_ADMIN)
  @UseGuards(AdminRoleGuard)
  createManualPayment(
    @CurrentAdmin() admin: AdminActor,
    @Param('id') id: string,
    @Body() body: CreateManualPaymentDto,
  ) {
    return this.security.createManualPayment(admin, id, body);
  }

  @Post('payments/intents/:id/confirm')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.FINANCE_ADMIN)
  @UseGuards(AdminRoleGuard)
  confirmManualPayment(@CurrentAdmin() admin: AdminActor, @Param('id') id: string) {
    return this.security.confirmManualPayment(admin, id);
  }

  @Get('orders')
  @Header('Cache-Control', 'no-store')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SECURITY_ADMIN, AdminRole.SUPPORT_ADMIN)
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
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SECURITY_ADMIN, AdminRole.SUPPORT_ADMIN)
  @UseGuards(AdminRoleGuard)
  async order(@CurrentAdmin() admin: AdminActor, @Param('id') id: string) {
    const order = await this.security.getOrderInvestigation(id);
    if (!order) throw new NotFoundException('Сделка не найдена.');
    await this.security.logAction(admin, 'ADMIN_VIEW_ORDER', { type: 'Order', id: order.id });
    return order;
  }

  @Post('orders/:id/refund')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN, AdminRole.FINANCE_ADMIN)
  @UseGuards(AdminRoleGuard)
  refundOrder(@CurrentAdmin() admin: AdminActor, @Param('id') id: string, @Body() body: { reason?: string }) {
    return this.security.refundOrder(admin, id, body.reason);
  }

  @Post('orders/:id/complete')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN)
  @UseGuards(AdminRoleGuard)
  completeOrder(@CurrentAdmin() admin: AdminActor, @Param('id') id: string, @Body() body: { reason?: string }) {
    return this.security.completeOrder(admin, id, body.reason);
  }

  @Get('support/queue')
  @Header('Cache-Control', 'no-store')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN)
  @UseGuards(AdminRoleGuard)
  async supportQueue(@CurrentAdmin() admin: AdminActor) {
    const queue = await this.security.listSupportQueue();
    await this.security.logAction(admin, 'ADMIN_LIST_SUPPORT_QUEUE', { metadata: { count: queue.length } });
    return { queue };
  }

  @Post('support/tickets/:id/close')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN)
  @UseGuards(AdminRoleGuard)
  closeTicket(@CurrentAdmin() admin: AdminActor, @Param('id') id: string, @Body() body: { reason?: string }) {
    return this.security.closeSupportTicket(admin, id, body.reason);
  }

  @Get('support/reports')
  @Header('Cache-Control', 'no-store')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN)
  @UseGuards(AdminRoleGuard)
  async reports(@CurrentAdmin() admin: AdminActor) {
    const reports = await this.security.listReports();
    await this.security.logAction(admin, 'ADMIN_LIST_REPORTS', { metadata: { count: reports.length } });
    return { reports };
  }

  @Post('support/reports/:id/reply')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN)
  @UseGuards(AdminRoleGuard)
  replyReport(@CurrentAdmin() admin: AdminActor, @Param('id') id: string, @Body() body: { text: string }) {
    return this.security.replyReport(admin, id, body.text);
  }

  @Post('support/reports/:id/uphold-appeal')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN)
  @UseGuards(AdminRoleGuard)
  upholdAppeal(@CurrentAdmin() admin: AdminActor, @Param('id') id: string) {
    return this.security.upholdReviewAppeal(admin, id);
  }

  @Post('support/reports/:id/close')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN)
  @UseGuards(AdminRoleGuard)
  closeReport(@CurrentAdmin() admin: AdminActor, @Param('id') id: string, @Body() body: { reason?: string }) {
    return this.security.closeReport(admin, id, body.reason);
  }

  @Get('products')
  @Header('Cache-Control', 'no-store')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SECURITY_ADMIN, AdminRole.SUPPORT_ADMIN)
  @UseGuards(AdminRoleGuard)
  async products(@CurrentAdmin() admin: AdminActor, @Query('limit') limit?: string, @Query('status') status?: string) {
    const products = await this.security.listProducts({ limit: limit ? Number(limit) : 100, status });
    await this.security.logAction(admin, 'ADMIN_LIST_PRODUCTS', { metadata: { count: products.length, status: status ?? 'ALL' } });
    return { products };
  }

  @Get('products/:id')
  @Header('Cache-Control', 'no-store')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SECURITY_ADMIN, AdminRole.SUPPORT_ADMIN)
  @UseGuards(AdminRoleGuard)
  async product(@CurrentAdmin() admin: AdminActor, @Param('id') id: string) {
    const product = await this.security.getProduct(id);
    await this.security.logAction(admin, 'ADMIN_VIEW_PRODUCT', { type: 'Product', id });
    return product;
  }

  @Delete('products/:id')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SECURITY_ADMIN, AdminRole.SUPPORT_ADMIN)
  @UseGuards(AdminRoleGuard)
  removeProduct(@CurrentAdmin() admin: AdminActor, @Param('id') id: string, @Body() body: { reason?: string }) {
    return this.security.moderateProduct(admin, id, body.reason);
  }

  @Get('messages')
  @Header('Cache-Control', 'no-store')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SECURITY_ADMIN, AdminRole.SUPPORT_ADMIN)
  @UseGuards(AdminRoleGuard)
  async messages(@CurrentAdmin() admin: AdminActor, @Query('limit') limit?: string, @Query('search') search?: string) {
    const messages = await this.security.listMessages({ limit: limit ? Number(limit) : 100, search });
    await this.security.logAction(admin, 'ADMIN_LIST_MESSAGES', { metadata: { count: messages.length, search: search ?? null } });
    return { messages };
  }

  @Get('chats/:id')
  @Header('Cache-Control', 'no-store')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SECURITY_ADMIN, AdminRole.SUPPORT_ADMIN)
  @UseGuards(AdminRoleGuard)
  async chat(@CurrentAdmin() admin: AdminActor, @Param('id') id: string) {
    const chat = await this.security.getChatThread(id);
    await this.security.logAction(admin, 'ADMIN_VIEW_CHAT', { type: 'Chat', id: chat.id });
    return chat;
  }

  @Delete('messages/:id')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SECURITY_ADMIN, AdminRole.SUPPORT_ADMIN)
  @UseGuards(AdminRoleGuard)
  removeMessage(@CurrentAdmin() admin: AdminActor, @Param('id') id: string, @Body() body: { reason?: string }) {
    return this.security.moderateMessage(admin, id, body.reason);
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

  @Get('risk/center')
  @Header('Cache-Control', 'no-store')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SECURITY_ADMIN, AdminRole.SUPPORT_ADMIN)
  @UseGuards(AdminRoleGuard)
  async riskCenter(@CurrentAdmin() admin: AdminActor) {
    const data = await this.security.listRiskCenter();
    await this.security.logAction(admin, 'ADMIN_RISK_CENTER', { metadata: { count: data.events.length } });
    return data;
  }

  @Get('support/tickets')
  @Header('Cache-Control', 'no-store')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN, AdminRole.SECURITY_ADMIN)
  @UseGuards(AdminRoleGuard)
  async ticketsList(
    @CurrentAdmin() admin: AdminActor,
    @Query('status') status?: string,
    @Query('category') category?: string,
  ) {
    const tickets = await this.tickets.listTickets({ status, category });
    await this.security.logAction(admin, 'ADMIN_LIST_TICKETS', { metadata: { count: tickets.length, status: status ?? 'ALL' } });
    return { tickets };
  }

  @Get('support/tickets/:id')
  @Header('Cache-Control', 'no-store')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN, AdminRole.SECURITY_ADMIN)
  @UseGuards(AdminRoleGuard)
  async ticketCard(@CurrentAdmin() admin: AdminActor, @Param('id') id: string) {
    const ticket = await this.tickets.getTicket(id);
    await this.security.logAction(admin, 'ADMIN_VIEW_TICKET', { type: 'SupportTicket', id });
    return ticket;
  }

  @Post('support/tickets/:id/status')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN, AdminRole.SECURITY_ADMIN)
  @UseGuards(AdminRoleGuard)
  ticketStatus(
    @CurrentAdmin() admin: AdminActor,
    @Param('id') id: string,
    @Body() body: { status: 'OPEN' | 'IN_REVIEW' | 'WAITING_USER' | 'RESOLVED' | 'CLOSED'; comment?: string },
  ) {
    return this.tickets.setStatus(admin, id, body.status, body.comment);
  }

  @Post('support/tickets/:id/comment')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SUPPORT_ADMIN, AdminRole.SECURITY_ADMIN)
  @UseGuards(AdminRoleGuard)
  ticketComment(
    @CurrentAdmin() admin: AdminActor,
    @Param('id') id: string,
    @Body() body: { text: string },
  ) {
    return this.tickets.addComment(admin, id, body.text);
  }

  @Post('support/tickets/:id/decision')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.SECURITY_ADMIN)
  @UseGuards(AdminRoleGuard)
  ticketDecision(
    @CurrentAdmin() admin: AdminActor,
    @Param('id') id: string,
    @Body() body: { decision: 'KEEP_LOCK' | 'UNLOCK' | 'REDUCE_RESTRICTIONS' | 'PERMANENT_BAN'; reason?: string },
  ) {
    return this.tickets.decideLock(admin, id, body.decision, body.reason);
  }
}
