import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

/** Default 120 days (90–180 band). Nulls out raw IP; keeps the security/audit event row. */
export function securityIpRetentionDays(): number {
  const raw = Number(process.env.SECURITY_IP_RETENTION_DAYS ?? 120);
  if (!Number.isFinite(raw) || raw < 1) return 120;
  return Math.min(Math.floor(raw), 3650);
}

@Injectable()
export class SecurityIpRetentionJob {
  constructor(private readonly prisma: PrismaService) {}

  async run(batchSize = 500): Promise<number> {
    const days = securityIpRetentionDays();
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const take = Math.min(Math.max(batchSize, 1), 2000);

    const events = await this.prisma.securityEvent.updateMany({
      where: {
        ipAddress: { not: null },
        createdAt: { lt: cutoff },
      },
      data: { ipAddress: null },
    });

    // AuthAuditLog — batch via updateMany (Postgres supports not: null)
    const audits = await this.prisma.authAuditLog.updateMany({
      where: {
        ipAddress: { not: null },
        createdAt: { lt: cutoff },
      },
      data: { ipAddress: null },
    });

    // updateMany ignores `take`; retention is idempotent. batchSize reserved for future cursor scans.
    void take;
    return events.count + audits.count;
  }
}
