import {
  BadRequestException, Controller, Delete, Get, Injectable, Module,
  NotFoundException, Param, Post,
} from '@nestjs/common';
import { AuthUser, CurrentUser } from './common';
import { PrismaService } from './prisma.service';

@Injectable()
export class SocialService {
  constructor(private readonly prisma: PrismaService) {}

  favorite(user: AuthUser, productId: string) {
    return this.prisma.favorite.upsert({
      where: { userId_productId: { userId: user.id, productId } },
      create: { userId: user.id, productId }, update: {},
    });
  }
  unfavorite(user: AuthUser, productId: string) {
    return this.prisma.favorite.deleteMany({ where: { userId: user.id, productId } });
  }
  favorites(user: AuthUser) {
    return this.prisma.favorite.findMany({
      where: { userId: user.id, product: { status: 'ACTIVE' } },
      include: { product: { include: { seller: { select: { onixId: true, telegramNick: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
  }
  async follow(user: AuthUser, onixId: string) {
    const seller = await this.target(onixId);
    if (seller.id === user.id) throw new BadRequestException('Нельзя подписаться на себя.');
    return this.prisma.follow.upsert({
      where: { followerId_sellerId: { followerId: user.id, sellerId: seller.id } },
      create: { followerId: user.id, sellerId: seller.id }, update: {},
    });
  }
  async unfollow(user: AuthUser, onixId: string) {
    const seller = await this.target(onixId);
    return this.prisma.follow.deleteMany({ where: { followerId: user.id, sellerId: seller.id } });
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
  private async target(onixId: string) {
    const user = await this.prisma.user.findUnique({ where: { onixId } });
    if (!user) throw new NotFoundException('Пользователь не найден.');
    return user;
  }
}

@Controller()
export class SocialController {
  constructor(private readonly service: SocialService) {}
  @Get('favorites') favorites(@CurrentUser() user: AuthUser) { return this.service.favorites(user); }
  @Post('favorites/:productId') favorite(@CurrentUser() user: AuthUser, @Param('productId') id: string) { return this.service.favorite(user, id); }
  @Delete('favorites/:productId') unfavorite(@CurrentUser() user: AuthUser, @Param('productId') id: string) { return this.service.unfavorite(user, id); }
  @Post('users/:onixId/follow') follow(@CurrentUser() user: AuthUser, @Param('onixId') id: string) { return this.service.follow(user, id); }
  @Delete('users/:onixId/follow') unfollow(@CurrentUser() user: AuthUser, @Param('onixId') id: string) { return this.service.unfollow(user, id); }
  @Post('users/:onixId/block') block(@CurrentUser() user: AuthUser, @Param('onixId') id: string) { return this.service.block(user, id); }
  @Delete('users/:onixId/block') unblock(@CurrentUser() user: AuthUser, @Param('onixId') id: string) { return this.service.unblock(user, id); }
}

@Module({ controllers: [SocialController], providers: [SocialService] })
export class SocialModule {}
