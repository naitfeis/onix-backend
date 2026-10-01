-- Two admin-driven fraud mechanisms that did not exist before.
--
-- 1) fraudWatch* -- "do not ban yet, wait for the money".
--    A confirmed complaint against an account with zero balance used to force a choice:
--    ban now (nothing to repay the buyer with) or do nothing. The marker keeps SELLING open
--    so the seller can still earn, and the first completed sale triggers an automatic ban
--    plus clawback. Selling is deliberately NOT banned while the marker is set -- banning
--    it would freeze the debt forever.
--
-- 2) banStrikeCount -- escalation for repeat offenders.
--    Duration now grows with prior bans instead of restarting from the same window,
--    and a third strike is permanent. See src/ban-policy.ts.
ALTER TABLE "User" ADD COLUMN "banStrikeCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "fraudWatchAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "fraudWatchReason" VARCHAR(1000);
-- Admin-declared repayment target. No FK on purpose: the victim may have been wiped
-- (tombstoned) and the claim must survive that. Validated when the marker is set.
ALTER TABLE "User" ADD COLUMN "fraudWatchVictimUserId" BIGINT;
ALTER TABLE "User" ADD COLUMN "fraudWatchClaimCents" BIGINT NOT NULL DEFAULT 0;

CREATE INDEX "User_fraudWatchAt_idx" ON "User"("fraudWatchAt");

-- ADD VALUE cannot run inside a transaction block in older PostgreSQL, but Prisma
-- migrate runs each migration in one; IF NOT EXISTS keeps this idempotent regardless.
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'FRAUD_WATCH_TRIGGERED';