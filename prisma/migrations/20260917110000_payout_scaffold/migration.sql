-- Workstream A: provider-agnostic payout lifecycle.
ALTER TYPE "LedgerEntryType" ADD VALUE IF NOT EXISTS 'WITHDRAWAL_REVERSAL';

CREATE TYPE "PayoutRequestStatus" AS ENUM (
  'REQUESTED',
  'RISK_REVIEW',
  'APPROVED',
  'PROCESSING',
  'PAID',
  'FAILED',
  'REJECTED',
  'MANUAL_REVIEW'
);

CREATE TYPE "PayoutAttemptStatus" AS ENUM (
  'STARTED',
  'SUBMITTED',
  'FAILED',
  'MANUAL_REVIEW'
);

CREATE TYPE "PayoutProviderCode" AS ENUM ('MANUAL');

CREATE TABLE "PayoutRequest" (
  "id" TEXT NOT NULL,
  "userId" BIGINT NOT NULL,
  "withdrawalLedgerEntryId" BIGINT NOT NULL,
  "refundLedgerEntryId" BIGINT,
  "requestKey" VARCHAR(120) NOT NULL,
  "status" "PayoutRequestStatus" NOT NULL DEFAULT 'REQUESTED',
  "provider" "PayoutProviderCode" NOT NULL DEFAULT 'MANUAL',
  "amountCents" BIGINT NOT NULL,
  "currency" VARCHAR(8) NOT NULL DEFAULT 'RUB',
  "destinationFingerprint" VARCHAR(128),
  "riskReasons" JSONB,
  "reviewReason" VARCHAR(1000),
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "processingStartedAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayoutRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payout_request_amount_positive" CHECK ("amountCents" > 0)
);

CREATE TABLE "PayoutAttempt" (
  "id" TEXT NOT NULL,
  "payoutRequestId" TEXT NOT NULL,
  "provider" "PayoutProviderCode" NOT NULL,
  "status" "PayoutAttemptStatus" NOT NULL DEFAULT 'STARTED',
  "attemptKey" VARCHAR(120) NOT NULL,
  "providerReference" VARCHAR(191),
  "errorCode" VARCHAR(64),
  "errorMessage" VARCHAR(1000),
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "PayoutAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayoutRequest_withdrawalLedgerEntryId_key"
  ON "PayoutRequest"("withdrawalLedgerEntryId");
CREATE UNIQUE INDEX "PayoutRequest_refundLedgerEntryId_key"
  ON "PayoutRequest"("refundLedgerEntryId");
CREATE UNIQUE INDEX "PayoutRequest_requestKey_key"
  ON "PayoutRequest"("requestKey");
CREATE INDEX "PayoutRequest_status_requestedAt_idx"
  ON "PayoutRequest"("status", "requestedAt");
CREATE INDEX "PayoutRequest_userId_requestedAt_idx"
  ON "PayoutRequest"("userId", "requestedAt");
CREATE UNIQUE INDEX "PayoutAttempt_attemptKey_key"
  ON "PayoutAttempt"("attemptKey");
CREATE INDEX "PayoutAttempt_payoutRequestId_startedAt_idx"
  ON "PayoutAttempt"("payoutRequestId", "startedAt");
CREATE INDEX "PayoutAttempt_status_startedAt_idx"
  ON "PayoutAttempt"("status", "startedAt");

ALTER TABLE "PayoutRequest"
  ADD CONSTRAINT "PayoutRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayoutRequest"
  ADD CONSTRAINT "PayoutRequest_withdrawalLedgerEntryId_fkey"
  FOREIGN KEY ("withdrawalLedgerEntryId") REFERENCES "LedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayoutRequest"
  ADD CONSTRAINT "PayoutRequest_refundLedgerEntryId_fkey"
  FOREIGN KEY ("refundLedgerEntryId") REFERENCES "LedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PayoutAttempt"
  ADD CONSTRAINT "PayoutAttempt_payoutRequestId_fkey"
  FOREIGN KEY ("payoutRequestId") REFERENCES "PayoutRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
