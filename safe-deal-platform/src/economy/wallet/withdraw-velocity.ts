import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

export type WithdrawVelocityTier = 'new' | 'trusted';

export type WithdrawVelocityLimits = {
  tier: WithdrawVelocityTier;
  windowMs: number;
  maxCount: number;
  maxCents: bigint;
};

export function withdrawVelocityWindowMs(): number {
  const n = Number(process.env.WITHDRAW_VELOCITY_WINDOW_MS ?? 86_400_000);
  return Number.isFinite(n) && n >= 60_000 ? Math.floor(n) : 86_400_000;
}

export function withdrawVelocityNewAccountDays(): number {
  const n = Number(process.env.WITHDRAW_VELOCITY_NEW_ACCOUNT_DAYS ?? 7);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 7;
}

export function withdrawVelocityEnforceEnabled(): boolean {
  const raw = (process.env.WITHDRAW_VELOCITY_ENFORCE ?? 'true').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'no';
}

function envBigInt(name: string, fallback: bigint): bigint {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return BigInt(Math.floor(n));
}

function envCount(name: string, fallback: number): number {
  const n = Number(process.env[name] ?? fallback);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function resolveWithdrawVelocityLimits(accountCreatedAt: Date, now = new Date()): WithdrawVelocityLimits {
  const ageMs = now.getTime() - accountCreatedAt.getTime();
  const newMs = withdrawVelocityNewAccountDays() * 86_400_000;
  const isNew = ageMs < newMs;
  if (isNew) {
    return {
      tier: 'new',
      windowMs: withdrawVelocityWindowMs(),
      maxCount: envCount('WITHDRAW_VELOCITY_NEW_MAX_COUNT', 1),
      maxCents: envBigInt('WITHDRAW_VELOCITY_NEW_MAX_CENTS', 5_000_000n),
    };
  }
  return {
    tier: 'trusted',
    windowMs: withdrawVelocityWindowMs(),
    maxCount: envCount('WITHDRAW_VELOCITY_TRUSTED_MAX_COUNT', 5),
    maxCents: envBigInt('WITHDRAW_VELOCITY_TRUSTED_MAX_CENTS', 20_000_000n),
  };
}

/**
 * Slice 4 — withdrawal count/sum limits over a rolling window.
 * Soft rollout: WITHDRAW_VELOCITY_ENFORCE=false logs and allows.
 */
@Injectable()
export class WithdrawVelocityService {
  private readonly logger = new Logger(WithdrawVelocityService.name);

  constructor(private readonly prisma: PrismaService) {}

  async assertAllowed(input: {
    userId: bigint;
    amountCents: bigint;
    db?: Db;
  }): Promise<WithdrawVelocityLimits> {
    const db = input.db ?? this.prisma;
    const user = await db.user.findUniqueOrThrow({
      where: { id: input.userId },
      select: { createdAt: true },
    });
    const limits = resolveWithdrawVelocityLimits(user.createdAt);
    const since = new Date(Date.now() - limits.windowMs);

    const rows = await db.ledgerEntry.findMany({
      where: {
        userId: input.userId,
        type: 'WITHDRAWAL',
        createdAt: { gte: since },
      },
      select: { amountCents: true },
    });

    let usedCount = rows.length;
    let usedCents = 0n;
    for (const row of rows) {
      const abs = row.amountCents < 0n ? -row.amountCents : row.amountCents;
      usedCents += abs;
    }

    const nextCount = usedCount + 1;
    const nextCents = usedCents + input.amountCents;
    const countOk = nextCount <= limits.maxCount;
    const sumOk = nextCents <= limits.maxCents;

    if (countOk && sumOk) return limits;

    const payload = {
      msg: 'withdraw_velocity_breach',
      userId: input.userId.toString(),
      tier: limits.tier,
      usedCount,
      usedCents: usedCents.toString(),
      nextCount,
      nextCents: nextCents.toString(),
      maxCount: limits.maxCount,
      maxCents: limits.maxCents.toString(),
      enforce: withdrawVelocityEnforceEnabled(),
    };

    if (!withdrawVelocityEnforceEnabled()) {
      this.logger.warn(JSON.stringify(payload));
      return limits;
    }

    this.logger.warn(JSON.stringify(payload));
    if (!countOk) {
      throw new BadRequestException(
        `Превышен лимит выводов (${limits.maxCount} за ${Math.round(limits.windowMs / 3_600_000)} ч). Попробуйте позже.`,
      );
    }
    throw new BadRequestException(
      `Превышена сумма выводов за период (лимит ${Number(limits.maxCents) / 100} ₽). Попробуйте позже или уменьшите сумму.`,
    );
  }
}
