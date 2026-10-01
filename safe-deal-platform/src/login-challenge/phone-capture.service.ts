import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { hashPhone, maskPhone, normalizePhone, phoneRequiredToSell } from '../phone-hash';
import { RiskScoreService } from '../risk-score.service';
import { SecurityLockService } from '../risk/security-lock.service';

export type PhoneCaptureResult =
  | { kind: 'saved'; alreadyVerified: boolean; phoneMasked: string }
  | { kind: 'conflict' }
  | { kind: 'invalid' }
  | { kind: 'disabled' };

/**
 * Captures the phone number a seller shares through Telegram.
 *
 * Telegram delivers `message.contact` to the BOT webhook — the Mini App only learns
 * whether the popup was accepted — so this is the single place the number lands. The
 * raw value is hashed immediately and discarded; only the HMAC is persisted.
 *
 * The conflict branch is the point of the whole feature: because `phoneHash` is unique
 * and survives account deletion, one phone cannot front a second account.
 */
@Injectable()
export class PhoneCaptureService {
  private readonly logger = new Logger(PhoneCaptureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly risk: RiskScoreService,
    private readonly locks: SecurityLockService,
  ) {}

  /**
   * Whether this Telegram chat already has a verified phone. Used to skip the prompt
   * so returning sellers are not asked again on every bare `/start`.
   */
  async isPhoneSharedForChat(chatId: number): Promise<boolean> {
    if (!phoneRequiredToSell()) return true;
    const user = await this.prisma.user.findFirst({
      where: { telegramId: BigInt(chatId) },
      select: { phoneHash: true },
    }).catch(() => null);
    return Boolean(user?.phoneHash);
  }

  async capture(telegramId: bigint, rawPhone: string | null | undefined): Promise<PhoneCaptureResult> {
    if (!phoneRequiredToSell()) return { kind: 'disabled' };

    const normalized = normalizePhone(rawPhone);
    const phoneHash = hashPhone(rawPhone);
    if (!normalized || !phoneHash) return { kind: 'invalid' };

    const user = await this.prisma.user.findUnique({
      where: { telegramId },
      select: { id: true, phoneHash: true },
    });
    if (!user) return { kind: 'invalid' };

    // Same person, same account: nothing to do, and never overwrite the first
    // verification timestamp — it is evidence of when the anchor was established.
    if (user.phoneHash === phoneHash) {
      return { kind: 'saved', alreadyVerified: true, phoneMasked: maskPhone(normalized) };
    }

    // A phone already bound elsewhere (including a deleted/banned account) must not
    // migrate: that is exactly how a banned seller would rebuild an identity.
    const existing = await this.prisma.user.findFirst({
      where: { phoneHash, id: { not: user.id } },
      select: { id: true, onixId: true, bannedAt: true, deletedAt: true, securityLockedAt: true },
    });
    if (existing) {
      await this.flagPhoneReuse(user.id, existing, phoneHash);
      return { kind: 'conflict' };
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { phoneHash, phoneSharedAt: new Date() },
    });

    // Arm the PHONE_HASH marker. Note the enforcement point: signup cannot check a phone,
    // because a new account has not shared one yet (the number only arrives later through
    // the Telegram contact button). The marker therefore bites HERE, in capture(), via the
    // conflict branch above, and at registration it only contributes if the newcomer has
    // somehow re-used an identity that is compared by collectSignals.
    await this.recordPhoneMarker(user.id, phoneHash);

    this.logger.log(JSON.stringify({
      msg: 'seller phone captured',
      userId: user.id.toString(),
      phoneMasked: maskPhone(normalized),
    }));
    return { kind: 'saved', alreadyVerified: false, phoneMasked: maskPhone(normalized) };
  }

  /** PHONE_HASH marker so a future account cannot reuse this number. */
  private async recordPhoneMarker(userId: bigint, phoneHash: string): Promise<void> {
    try {
      await this.prisma.abuseMarker.upsert({
        where: { kind_valueHash: { kind: 'PHONE_HASH', valueHash: phoneHash } },
        create: { kind: 'PHONE_HASH', valueHash: phoneHash, sourceUserId: userId },
        update: { sourceUserId: userId, revokedAt: null },
      });
    } catch (error) {
      // Marker failure must not lose the phone itself; log so ops can backfill.
      this.logger.warn(JSON.stringify({
        msg: 'PHONE_HASH marker write failed',
        userId: userId.toString(),
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  /**
   * Reuse of a phone that belonged to a punished account is a strong ban-evasion
   * signal: block withdrawals and selling until support reviews it.
   */
  private async flagPhoneReuse(
    userId: bigint,
    existing: { id: bigint; onixId: string; bannedAt: Date | null; deletedAt: Date | null; securityLockedAt: Date | null },
    phoneHash: string,
  ): Promise<void> {
    const punished = Boolean(existing.bannedAt || existing.deletedAt || existing.securityLockedAt);
    await this.prisma.securityEvent.create({
      data: {
        userId,
        type: 'BAN_EVASION',
        status: 'OPEN',
        severity: punished ? 90 : 55,
        payload: {
          kind: 'PHONE_REUSE',
          phoneHash,
          linkedUserId: existing.id.toString(),
          linkedOnixId: existing.onixId,
          linkedBanned: Boolean(existing.bannedAt),
          linkedDeleted: Boolean(existing.deletedAt),
          linkedSecurityLocked: Boolean(existing.securityLockedAt),
        },
      },
    }).catch(() => undefined);

    if (!punished) return;

    // Markers from the punished account first, so any further signup attempt on the
    // same device/IP/phone/telegram is caught at registration.
    await this.risk.recordBanMarkers(this.prisma, existing.id).catch(() => undefined);

    // MUST go through SecurityLockService: a raw securityLockedAt write would skip
    // sellBannedAt / withdrawBlockedAt / suspiciousFundsHoldAt, session revocation,
    // the public case id and the appeal ticket — i.e. the lock would be cosmetic.
    await this.locks.applyLock({
      userId,
      level: 'HIGH',
      eventType: 'BAN_EVASION',
      reasons: ['PHONE_REUSE_BANNED_ACCOUNT', `linkedUserId=${existing.id.toString()}`],
      score: 90,
    }).catch((error) => {
      this.logger.error(JSON.stringify({
        msg: 'phone reuse lock failed',
        userId: userId.toString(),
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  }
}
