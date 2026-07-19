/**
 * Money invariant audit against live DATABASE_URL.
 *
 * Usage:
 *   npm run ops:money-audit
 *
 * Exit 0 when ok; exit 1 when any mismatch. Never auto-fixes.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { loadEnvFiles } from '../src/env';

loadEnvFiles();

type AuditReport = {
  ok: boolean;
  scannedUsers: number;
  walletMismatches: number;
  negativeBalances: number;
  negativeDeposits: number;
  depositLockMismatches: number;
  duplicatePayouts: number;
  completedWithoutPayout: number;
  orphanSucceededPayments: number;
  duplicatePaymentCredits: number;
  orphanLedgerPayments: number;
};

async function main(): Promise<void> {
  const url = (process.env.DATABASE_URL ?? '').trim();
  if (!url) {
    console.error(JSON.stringify({ ok: false, error: 'DATABASE_URL required' }, null, 2));
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, max: 2 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const report: AuditReport = {
    ok: true,
    scannedUsers: 0,
    walletMismatches: 0,
    negativeBalances: 0,
    negativeDeposits: 0,
    depositLockMismatches: 0,
    duplicatePayouts: 0,
    completedWithoutPayout: 0,
    orphanSucceededPayments: 0,
    duplicatePaymentCredits: 0,
    orphanLedgerPayments: 0,
  };

  try {
    const users = await prisma.user.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        balanceCents: true,
        depositAvailableCents: true,
        depositLockedCents: true,
      },
      take: 5_000,
    });
    report.scannedUsers = users.length;

    for (const user of users) {
      if (user.balanceCents < 0n) report.negativeBalances += 1;
      if (user.depositAvailableCents < 0n || user.depositLockedCents < 0n) {
        report.negativeDeposits += 1;
      }

      const last = await prisma.ledgerEntry.findFirst({
        where: { userId: user.id },
        orderBy: { id: 'desc' },
        select: { balanceAfterCents: true },
      });
      if (last && last.balanceAfterCents !== user.balanceCents) {
        report.walletMismatches += 1;
      }

      const locks = await prisma.depositLock.aggregate({
        where: { userId: user.id, status: 'ACTIVE' },
        _sum: { amountCents: true },
      });
      if ((locks._sum.amountCents ?? 0n) !== user.depositLockedCents) {
        report.depositLockMismatches += 1;
      }
    }

    const completed = await prisma.order.findMany({
      where: { status: 'COMPLETED', payoutCents: { gt: 0 } },
      select: { id: true },
      take: 2_000,
    });
    for (const order of completed) {
      const payouts = await prisma.ledgerEntry.count({
        where: { orderId: order.id, type: 'SALE_PAYOUT' },
      });
      if (payouts === 0) report.completedWithoutPayout += 1;
      if (payouts > 1) report.duplicatePayouts += 1;
    }

    const succeeded = await prisma.paymentIntent.findMany({
      where: { status: 'SUCCEEDED' },
      select: { id: true, wallet: true },
      take: 2_000,
    });
    for (const intent of succeeded) {
      if (intent.wallet === 'MAIN') {
        const n = await prisma.ledgerEntry.count({
          where: { idempotencyKey: `payment:${intent.id}:main`, type: 'DEPOSIT' },
        });
        if (n === 0) report.orphanSucceededPayments += 1;
        if (n > 1) report.duplicatePaymentCredits += 1;
      } else {
        const n = await prisma.depositLedgerEntry.count({
          where: { idempotencyKey: `payment:${intent.id}:deposit`, type: 'TOPUP' },
        });
        if (n === 0) report.orphanSucceededPayments += 1;
        if (n > 1) report.duplicatePaymentCredits += 1;
      }
    }

    // Ledger credits keyed as payment:* with no matching SUCCEEDED intent.
    const paymentLedgers = await prisma.ledgerEntry.findMany({
      where: { type: 'DEPOSIT', idempotencyKey: { startsWith: 'payment:' } },
      select: { idempotencyKey: true },
      take: 2_000,
    });
    for (const row of paymentLedgers) {
      const m = /^payment:([^:]+):main$/.exec(row.idempotencyKey);
      if (!m) continue;
      const intent = await prisma.paymentIntent.findUnique({
        where: { id: m[1]! },
        select: { status: true },
      });
      if (!intent || intent.status !== 'SUCCEEDED') {
        report.orphanLedgerPayments += 1;
      }
    }

    report.ok =
      report.walletMismatches === 0
      && report.negativeBalances === 0
      && report.negativeDeposits === 0
      && report.depositLockMismatches === 0
      && report.duplicatePayouts === 0
      && report.completedWithoutPayout === 0
      && report.orphanSucceededPayments === 0
      && report.duplicatePaymentCredits === 0
      && report.orphanLedgerPayments === 0;

    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    error: err instanceof Error ? err.message : 'money-audit failed',
  }, null, 2));
  process.exit(1);
});
