import {
  Controller, Get, Header, Injectable, Module, NotFoundException, Param, Patch, Post, Body, Query, Req,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AuthRequest, AuthUser, CurrentUser } from './common';
import { withSerializableTransaction } from './database/transaction-retry';
import { lockUsersInIdOrder } from './database/money-locks';
import { EconomyModule } from './economy/economy.module';
import { buildPublicTrustCard } from './economy/trust/trust-card';
import { LockService } from './economy/wallet/lock.service';
import { findUserByOnixId } from './onix-id-lookup';
import { PrismaService } from './prisma.service';
import { assertRateLimit } from './rate-limit';
import { RealtimeBus } from './realtime/realtime-bus.service';
import { RealtimeModule } from './realtime/realtime.module';
import { ledgerDto, profileDto, reviewDto, sellerDto } from './response';

/** First page embedded in GET /users/me — further pages via GET /wallet/ledger. */
const WALLET_HISTORY_PAGE = 15;

class UpdateProfileDto {
  @IsOptional() @IsString() @MaxLength(120) displayName?: string;
  @IsOptional() @IsString() @MaxLength(500) bio?: string;
}

class LedgerQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = WALLET_HISTORY_PAGE;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000) offset = 0;
}

/** Skip DB/WS fan-out if the same user already pinged within this window. */
const PRESENCE_MIN_MS = 45_000;
const lastPresenceWriteAt = new Map<string, { at: number; lastOnline: string }>();

@Injectable()
export class ProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locks: LockService,
    private readonly realtime: RealtimeBus,
  ) {}

  /**
   * Owner profile — single RTT: balance + deposit (after lazy unlock) + public trust card.
   * Does NOT return internal trustScore.
   */
  async getMe(user: AuthUser) {
    const now = new Date();
    const [, dueLock] = await Promise.all([
      this.prisma.user.update({
        where: { id: user.id },
        data: { lastSeenAt: now },
      }),
      this.prisma.depositLock.findFirst({
        where: { userId: user.id, status: 'ACTIVE', unlockAt: { lte: now } },
        select: { id: true },
      }),
    ]);
    if (dueLock) {
      await withSerializableTransaction(this.prisma, async (tx) => {
        await lockUsersInIdOrder(tx, [user.id]);
        await this.locks.releaseExpiredForUser(tx, user.id);
      });
    }

    const [profile, ledger, googleLink] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: {
          id: true, onixId: true, telegramNick: true, displayName: true, avatarUrl: true, bio: true,
          balanceCents: true,
          depositAvailableCents: true, depositLockedCents: true,
          trustLevel: true, createdAt: true,
          ratingAverage: true, ratingCount: true, completedSales: true,
          lastSeenAt: true, isAdmin: true, isSupport: true, platformStatus: true,
          telegramId: true, sellBannedAt: true,
          _count: { select: { followers: true } },
          sellerSubscription: { select: { status: true, endsAt: true } },
        },
      }),
      this.prisma.ledgerEntry.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: WALLET_HISTORY_PAGE,
      }),
      this.prisma.identityLink.findFirst({
        where: { userId: user.id, provider: 'GOOGLE', deletedAt: null },
        select: { id: true },
      }),
    ]);

    const proActive = Boolean(
      profile.sellerSubscription
      && profile.sellerSubscription.status === 'ACTIVE'
      && (!profile.sellerSubscription.endsAt || profile.sellerSubscription.endsAt > new Date()),
    );
    const depositTotal = profile.depositAvailableCents + profile.depositLockedCents;
    const base = profileDto(profile, ledger);
    const hasTelegram = profile.telegramId != null;
    return {
      ...base,
      canSell: hasTelegram && !profile.sellBannedAt,
      hasTelegram,
      hasGoogle: Boolean(googleLink),
      deposit: {
        availableCents: profile.depositAvailableCents.toString(),
        lockedCents: profile.depositLockedCents.toString(),
        totalCents: depositTotal.toString(),
      },
      trustCard: buildPublicTrustCard({
        trustLevel: profile.trustLevel,
        depositAvailableCents: profile.depositAvailableCents,
        depositLockedCents: profile.depositLockedCents,
        createdAt: profile.createdAt,
        ratingAverage: profile.ratingAverage,
        ratingCount: profile.ratingCount,
        completedSales: profile.completedSales,
        proActive,
      }),
    };
  }

  /** Public profile — no balance / ledger / private deal history / trustScore. */
  async getPublic(viewer: AuthUser, onixId: string) {
    const resolved = await findUserByOnixId(this.prisma, onixId);
    if (!resolved) throw new NotFoundException('Профиль не найден.');
    const profile = await this.prisma.user.findUnique({
      where: { id: resolved.id },
      select: {
        id: true, onixId: true, telegramNick: true, displayName: true, avatarUrl: true, bio: true,
        ratingAverage: true, ratingCount: true, completedSales: true, lastSeenAt: true,
        createdAt: true, isAdmin: true, isSupport: true, platformStatus: true, deletedAt: true, sellBannedAt: true,
        _count: { select: { followers: true } },
        followers: { where: { followerId: viewer.id }, select: { followerId: true }, take: 1 },
        products: {
          where: {
            status: 'ACTIVE',
            ...(viewer.id === resolved.id ? {} : { shadowBannedAt: null }),
          },
          orderBy: { createdAt: 'desc' },
          take: 30,
          select: {
            id: true, title: true, description: true, priceCents: true, category: true,
            subcategory: true, status: true, createdAt: true, quantity: true,
            warrantyHours: true, lotNumber: true,
          },
        },
        reviewsReceived: {
          where: { hiddenAt: null },
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: { author: { select: { id: true, onixId: true, displayName: true, telegramNick: true, avatarUrl: true, isAdmin: true, isSupport: true, platformStatus: true } } },
        },
      },
    });
    if (!profile || profile.deletedAt) throw new NotFoundException('Профиль не найден.');
    return {
      ...sellerDto({
        ...profile,
        _count: profile._count,
        followers: profile.followers,
      }),
      bio: profile.bio,
      createdAt: profile.createdAt.toISOString(),
      ...(viewer.isAdmin ? { sellBanned: Boolean(profile.sellBannedAt) } : {}),
      products: profile.products.map((p) => ({
        id: p.id,
        title: p.title,
        ...(p.description ? { description: p.description } : {}),
        priceCents: p.priceCents.toString(),
        category: p.category,
        ...(p.subcategory ? { subcategory: p.subcategory } : {}),
        status: p.status,
        quantity: p.quantity,
        createdAt: p.createdAt.toISOString(),
        warrantyHours: p.warrantyHours,
        ...(p.lotNumber != null ? { lotNumber: p.lotNumber } : {}),
      })),
      reviews: profile.reviewsReceived.map(reviewDto),
    };
  }

  update(user: AuthUser, dto: UpdateProfileDto) {
    return this.prisma.user.update({
      where: { id: user.id },
      data: dto,
      select: { onixId: true, displayName: true, bio: true, updatedAt: true },
    });
  }

  /** Lightweight presence ping — keeps lastSeenAt fresh while the Mini App is open. */
  async touchPresence(user: AuthUser) {
    const now = new Date();
    const key = String(user.id);
    const recent = lastPresenceWriteAt.get(key);
    if (recent && now.getTime() - recent.at < PRESENCE_MIN_MS) {
      return { lastOnline: recent.lastOnline, online: true as const };
    }
    const lastOnline = now.toISOString();
    lastPresenceWriteAt.set(key, { at: now.getTime(), lastOnline });
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastSeenAt: now },
    });
    await this.prisma.product.updateMany({
      where: { sellerId: user.id, shadowBannedAt: { not: null }, status: 'ACTIVE' },
      data: { shadowBannedAt: null },
    });
    const peers = await this.prisma.$queryRaw<Array<{ userId: bigint }>>`
      SELECT DISTINCT cm2."userId" AS "userId"
      FROM "ChatMember" cm1
      INNER JOIN "ChatMember" cm2 ON cm2."chatId" = cm1."chatId"
      WHERE cm1."userId" = ${user.id}
        AND cm2."userId" <> ${user.id}
      LIMIT 200
    `;
    this.realtime.publish({
      kind: 'presence',
      userId: user.id,
      onixId: user.onixId,
      online: true,
      lastOnline,
      watchers: peers.map((p) => p.userId),
    });
    lastPresenceWriteAt.set(key, { at: now.getTime(), lastOnline });
    if (lastPresenceWriteAt.size > 8_000) {
      const oldest = lastPresenceWriteAt.keys().next().value;
      if (oldest) lastPresenceWriteAt.delete(oldest);
    }
    return { lastOnline, online: true as const };
  }

  async ledger(user: AuthUser, query: LedgerQueryDto) {
    const limit = query.limit ?? WALLET_HISTORY_PAGE;
    const offset = query.offset ?? 0;
    const entries = await this.prisma.ledgerEntry.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
    return entries.map(ledgerDto);
  }
}

@Controller()
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}
  @Get('users/me')
  @Header('Cache-Control', 'private, no-store')
  me(@CurrentUser() user: AuthUser) { return this.profiles.getMe(user); }
  @Post('users/me/presence')
  @Header('Cache-Control', 'private, no-store')
  presence(@CurrentUser() user: AuthUser) { return this.profiles.touchPresence(user); }
  @Patch('users/me') update(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.profiles.update(user, dto);
  }
  @Get('users/:onixId') profile(
    @Req() req: AuthRequest,
    @CurrentUser() user: AuthUser,
    @Param('onixId') onixId: string,
  ) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
    assertRateLimit(`profile:${user.id}`, 60, 60_000);
    assertRateLimit(`profile-ip:${ip}`, 120, 60_000);
    return this.profiles.getPublic(user, onixId);
  }
  @Get('wallet/ledger')
  @Header('Cache-Control', 'private, no-store')
  ledger(@CurrentUser() user: AuthUser, @Query() query: LedgerQueryDto) {
    return this.profiles.ledger(user, query);
  }
}

@Module({
  imports: [EconomyModule, RealtimeModule],
  controllers: [ProfilesController],
  providers: [ProfilesService],
})
export class ProfilesModule {}
