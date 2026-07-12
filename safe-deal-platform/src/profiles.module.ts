import {
  Controller, Get, Injectable, Module, NotFoundException, Param, Patch, Body,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser } from './common';
import { PrismaService } from './prisma.service';
import { ledgerDto, profileDto, sellerDto } from './response';

class UpdateProfileDto {
  @IsOptional() @IsString() @MaxLength(120) displayName?: string;
  @IsOptional() @IsString() @MaxLength(500) bio?: string;
}

@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(user: AuthUser) {
    const [profile, ledger] = await this.prisma.$transaction([
      this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        id: true, onixId: true, telegramNick: true, displayName: true, avatarUrl: true,
        balanceCents: true, ratingAverage: true, ratingCount: true, completedSales: true,
        lastSeenAt: true, isAdmin: true, _count: { select: { followers: true } },
      },
      }),
      this.prisma.ledgerEntry.findMany({
        where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 100,
      }),
    ]);
    return profileDto(profile, ledger);
  }

  async getPublic(onixId: string) {
    const profile = await this.prisma.user.findUnique({
      where: { onixId },
      select: {
        onixId: true, telegramNick: true, displayName: true, avatarUrl: true, bio: true,
        ratingAverage: true, ratingCount: true, completedSales: true, lastSeenAt: true,
        createdAt: true, _count: { select: { followers: true } },
        products: { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!profile) throw new NotFoundException('Профиль не найден.');
    return {
      ...sellerDto({
        id: 0n,
        ...profile,
        _count: profile._count,
      }),
      bio: profile.bio,
      createdAt: profile.createdAt.toISOString(),
      products: profile.products,
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
  @Get('users/me') me(@CurrentUser() user: AuthUser) { return this.profiles.getMe(user); }
  @Patch('users/me') update(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.profiles.update(user, dto);
  }
  @Get('users/:onixId') profile(@Param('onixId') onixId: string) {
    return this.profiles.getPublic(onixId);
  }
  @Get('wallet/ledger') ledger(@CurrentUser() user: AuthUser) { return this.profiles.ledger(user); }
}

@Module({ controllers: [ProfilesController], providers: [ProfilesService] })
export class ProfilesModule {}
