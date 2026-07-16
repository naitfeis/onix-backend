import {
  Controller, Get, Header, Injectable, Module, NotFoundException, Param, Patch, Body,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser } from './common';
import { PrismaService } from './prisma.service';
import { ledgerDto, profileDto, reviewDto, sellerDto } from './response';

class UpdateProfileDto {
  @IsOptional() @IsString() @MaxLength(120) displayName?: string;
  @IsOptional() @IsString() @MaxLength(500) bio?: string;
}

@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(user: AuthUser) {
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastSeenAt: new Date() },
    });
    const [profile, ledger] = await this.prisma.$transaction([
      this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        id: true, onixId: true, telegramNick: true, displayName: true, avatarUrl: true, bio: true,
        balanceCents: true, ratingAverage: true, ratingCount: true, completedSales: true,
        lastSeenAt: true, isAdmin: true, isSupport: true, _count: { select: { followers: true } },
      },
      }),
      this.prisma.ledgerEntry.findMany({
        where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 100,
      }),
    ]);
    return profileDto(profile, ledger);
  }

  /** Public profile — no balance / ledger / private deal history. */
  async getPublic(viewer: AuthUser, onixId: string) {
    const profile = await this.prisma.user.findUnique({
      where: { onixId },
      select: {
        id: true, onixId: true, telegramNick: true, displayName: true, avatarUrl: true, bio: true,
        ratingAverage: true, ratingCount: true, completedSales: true, lastSeenAt: true,
        createdAt: true, isAdmin: true, isSupport: true, deletedAt: true,
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
          include: { author: { select: { id: true, onixId: true, displayName: true, telegramNick: true, avatarUrl: true, isAdmin: true, isSupport: true } } },
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
  @Patch('users/me') update(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.profiles.update(user, dto);
  }
  @Get('users/:onixId') profile(@CurrentUser() user: AuthUser, @Param('onixId') onixId: string) {
    return this.profiles.getPublic(user, onixId);
  }
  @Get('wallet/ledger') ledger(@CurrentUser() user: AuthUser) { return this.profiles.ledger(user); }
}

@Module({ controllers: [ProfilesController], providers: [ProfilesService] })
export class ProfilesModule {}
