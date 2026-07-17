import {
  Controller, Get, Header, Injectable, Module, NotFoundException, Param, Patch, Post, Body,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Prisma } from '@prisma/client';
import { AuthUser, CurrentUser } from './common';
import { EconomyModule } from './economy/economy.module';
import { buildPublicTrustCard } from './economy/trust/trust-card';
import { LockService } from './economy/wallet/lock.service';
import { findUserByOnixId } from './onix-id-lookup';
import { PrismaService } from './prisma.service';
import { ledgerDto, profileDto, reviewDto, sellerDto } from './response';

class UpdateProfileDto {
  @IsOptional() @IsString() @MaxLength(120) displayName?: string;
  @IsOptional() @IsString() @MaxLength(500) bio?: string;
}

const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;

@Injectable()
export class ProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locks: LockService,
  ) {}

  /**
   * Owner profile — single RTT: balance + deposit (after lazy unlock) + public trust card.
   * Does NOT return internal trustScore.
   */
  async getMe(user: AuthUser) {
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastSeenAt: new Date() },
    });

    const { profile, ledger } = await this.prisma.$transaction(async (tx) => {
      await this.locks.releaseExpiredForUser(tx, user.id);
      const [row, entries] = await Promise.all([
        tx.user.findUniqueOrThrow({
          where: { id: user.id },
          select: {
            id: true, onixId: true, telegramNick: true, displayName: true, avatarUrl: true, bio: true,
            balanceCents: true,
            depositAvailableCents: true, depositLockedCents: true,
            trustLevel: true, createdAt: true,
            ratingAverage: true, ratingCount: true, completedSales: true,
            lastSeenAt: true, isAdmin: true, isSupport: true, platformStatus: true,
            _count: { select: { followers: true } },
            verifications: { select: { kind: true, status: true } },
            sellerSubscription: { select: { status: true, endsAt: true } },
          },
        }),
        tx.ledgerEntry.findMany({
          where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 100,
        }),
      ]);
      return { profile: row, ledger: entries };
    }, SERIALIZABLE);

    const proActive = Boolean(
      profile.sellerSubscription
      && profile.sellerSubscription.status === 'ACTIVE'
      && (!profile.sellerSubscription.endsAt || profile.sellerSubscription.endsAt > new Date()),
    );
    const depositTotal = profile.depositAvailableCents + profile.depositLockedCents;
    const base = profileDto(profile, ledger);
    return {
      ...base,
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
        verifications: profile.verifications,
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
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'desc' },
          take: 30,
          select: {
            id: true, title: true, description: true, priceCents: true, category: true,
            subcategory: true, status: true, createdAt: true, quantity: true,
          },
        },
        reviewsReceived: {
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
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastSeenAt: now },
    });
    return { lastOnline: now.toISOString(), online: true as const };
  }

  async ledger(user: AuthUser) {
    const entries = await this.prisma.ledgerEntry.findMany({
      where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 100,
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
  @Get('users/:onixId') profile(@CurrentUser() user: AuthUser, @Param('onixId') onixId: string) {
    return this.profiles.getPublic(user, onixId);
  }
  @Get('wallet/ledger') ledger(@CurrentUser() user: AuthUser) { return this.profiles.ledger(user); }
}

@Module({
  imports: [EconomyModule],
  controllers: [ProfilesController],
  providers: [ProfilesService],
})
export class ProfilesModule {}
