import {
  BadRequestException, Body, Controller, Delete, Get, Injectable, Module,
  NotFoundException, Param, Post,
} from '@nestjs/common';
import { BanReason } from '@prisma/client';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { BAN_REASON_LABELS } from './ban-policy';
import { AuthUser, CurrentUser } from './common';
import { pushTelegramToChatId } from './domain-notify';
import { PrismaService } from './prisma.service';
import { productListSelect, sellerPublicSelect } from './query-selects';
import { productDto } from './response';

class ReportUserDto {
  @IsEnum(BanReason) reason!: BanReason;
  @IsString() @MinLength(1) @MaxLength(1000) comment!: string;
}

/**
 * Favorites — own userId only; ACTIVE products only; composite PK prevents duplicates.
 * Policy: archived products are removed from favorites on archive (`marketplace.status`);
 * list returns ACTIVE only (same Product DTO as Marketplace).
 */
@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  async favorite(user: AuthUser, productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, status: true },
    });
    if (!product) throw new NotFoundException('Товар не найден.');
    if (product.status !== 'ACTIVE') {
      throw new BadRequestException('В избранное можно добавить только активный товар.');
    }
    return this.prisma.favorite.upsert({
      where: { userId_productId: { userId: user.id, productId } },
      create: { userId: user.id, productId },
      update: {},
    });
  }

  unfavorite(user: AuthUser, productId: string) {
    return this.prisma.favorite.deleteMany({ where: { userId: user.id, productId } });
  }

  /** Same Product DTO as Marketplace — purchase opens via GET /products/:id → EscrowService.purchase. */
  async favorites(user: AuthUser) {
    const rows = await this.prisma.favorite.findMany({
      where: { userId: user.id, product: { status: 'ACTIVE' } },
      select: {
        product: {
          select: {
            ...productListSelect,
            seller: { select: sellerPublicSelect(user.id) },
            favorites: { where: { userId: user.id }, select: { userId: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((row) => productDto(row.product, user.id));
  }
}

@Injectable()
export class SocialService {
  constructor(private readonly prisma: PrismaService) {}

  async follow(user: AuthUser, onixId: string) {
    const seller = await this.target(onixId);
    if (seller.id === user.id) throw new BadRequestException('Нельзя подписаться на себя.');
    await this.prisma.follow.upsert({
      where: { followerId_sellerId: { followerId: user.id, sellerId: seller.id } },
      create: { followerId: user.id, sellerId: seller.id }, update: {},
    });
    const followersCount = await this.prisma.follow.count({ where: { sellerId: seller.id } });
    return { onixId, followed: true, followersCount };
  }
  async unfollow(user: AuthUser, onixId: string) {
    const seller = await this.target(onixId);
    await this.prisma.follow.deleteMany({ where: { followerId: user.id, sellerId: seller.id } });
    const followersCount = await this.prisma.follow.count({ where: { sellerId: seller.id } });
    return { onixId, followed: false, followersCount };
  }
  async block(user: AuthUser, onixId: string) {
    const target = await this.target(onixId);
    if (target.id === user.id) throw new BadRequestException('Нельзя заблокировать себя.');
    return this.prisma.userBlock.upsert({
      where: { blockerId_blockedId: { blockerId: user.id, blockedId: target.id } },
      create: { blockerId: user.id, blockedId: target.id }, update: {},
    });
  }
  async unblock(user: AuthUser, onixId: string) {
    const target = await this.target(onixId);
    return this.prisma.userBlock.deleteMany({ where: { blockerId: user.id, blockedId: target.id } });
  }

  /** User report → DB + Telegram admin notify (no admin UI). */
  async report(user: AuthUser, onixId: string, dto: ReportUserDto) {
    const target = await this.target(onixId);
    if (target.id === user.id) throw new BadRequestException('Нельзя пожаловаться на себя.');
    const comment = dto.comment.trim();
    if (!comment) throw new BadRequestException('Укажите комментарий к жалобе.');
    const report = await this.prisma.userReport.create({
      data: {
        reporterId: user.id,
        targetId: target.id,
        reason: dto.reason,
        comment,
      },
    });
    const adminTg = process.env.ADMIN_TELEGRAM_ID?.trim();
    if (adminTg && /^\d+$/.test(adminTg)) {
      const appBase = (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',')[0]?.trim();
      const openUrl = appBase
        ? `${appBase.replace(/\/$/, '')}/?profile=${encodeURIComponent(target.onixId)}`
        : undefined;
      const body = [
        `От:\n${user.onixId}`,
        '',
        `На:\n${target.onixId}`,
        '',
        `Причина:\n${BAN_REASON_LABELS[dto.reason]}`,
        '',
        `Комментарий:\n${comment}`,
      ].join('\n');
      void pushTelegramToChatId(
        BigInt(adminTg),
        '🚨 Новая жалоба',
        body,
        openUrl ? { inline_keyboard: [[{ text: 'Открыть профиль', url: openUrl }]] } : undefined,
      );
    }
    return { id: report.id, targetOnixId: target.onixId };
  }

  private async target(onixId: string) {
    const user = await this.prisma.user.findUnique({ where: { onixId } });
    if (!user) throw new NotFoundException('Пользователь не найден.');
    return user;
  }
}

@Controller()
export class SocialController {
  constructor(
    private readonly social: SocialService,
    private readonly favorites: FavoritesService,
  ) {}

  @Get('favorites') listFavorites(@CurrentUser() user: AuthUser) { return this.favorites.favorites(user); }
  @Post('favorites/:productId') addFavorite(@CurrentUser() user: AuthUser, @Param('productId') id: string) {
    return this.favorites.favorite(user, id);
  }
  @Delete('favorites/:productId') removeFavorite(@CurrentUser() user: AuthUser, @Param('productId') id: string) {
    return this.favorites.unfavorite(user, id);
  }

  @Post('users/:onixId/follow') follow(@CurrentUser() user: AuthUser, @Param('onixId') id: string) {
    return this.social.follow(user, id);
  }
  @Delete('users/:onixId/follow') unfollow(@CurrentUser() user: AuthUser, @Param('onixId') id: string) {
    return this.social.unfollow(user, id);
  }
  @Post('users/:onixId/block') block(@CurrentUser() user: AuthUser, @Param('onixId') id: string) {
    return this.social.block(user, id);
  }
  @Delete('users/:onixId/block') unblock(@CurrentUser() user: AuthUser, @Param('onixId') id: string) {
    return this.social.unblock(user, id);
  }
  @Post('users/:onixId/report') report(
    @CurrentUser() user: AuthUser,
    @Param('onixId') id: string,
    @Body() dto: ReportUserDto,
  ) {
    return this.social.report(user, id, dto);
  }
}

@Module({
  controllers: [SocialController],
  providers: [SocialService, FavoritesService],
  exports: [FavoritesService],
})
export class SocialModule {}
