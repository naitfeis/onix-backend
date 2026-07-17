-- ONIX Trust & Seller Economy Stage 1 foundation (additive, backward-compatible)

-- User deposit + trust cache columns
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "depositAvailableCents" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "depositLockedCents" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "trustScore" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "trustLevel" SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "trustScoreVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "trustComputedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "trustDirty" BOOLEAN NOT NULL DEFAULT true;

DO $$ BEGIN
  CREATE TYPE "PaymentWallet" AS ENUM ('MAIN', 'DEPOSIT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PaymentProviderCode" AS ENUM ('MANUAL', 'YOOKASSA', 'TELEGRAM_WALLET', 'CRYPTO', 'CARD', 'STRIPE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PaymentIntentStatus" AS ENUM ('CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DepositLedgerType" AS ENUM ('TOPUP', 'WITHDRAW', 'LOCK', 'UNLOCK', 'SEIZE', 'ADMIN_ADJUST');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DepositLockStatus" AS ENUM ('ACTIVE', 'RELEASED', 'HELD_DISPUTE', 'SEIZED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "TrustHistoryType" AS ENUM (
    'LEVEL_UP', 'LEVEL_DOWN', 'DEPOSIT_CHANGED', 'DEPOSIT_LOCKED', 'DEPOSIT_UNLOCKED',
    'PHONE_VERIFIED', 'PASSPORT_VERIFIED', 'VOICE_VERIFIED', 'VERIFICATION_REVOKED',
    'PENALTY', 'PRO_GRANTED', 'PRO_ENDED', 'BADGE_GRANTED', 'RECOMPUTE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SellerVerificationKind" AS ENUM (
    'PHONE_SMS', 'PHONE_CALL', 'PHONE_VOICE', 'PASSPORT', 'VOICE_IDENTITY'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SellerVerificationStatus" AS ENUM ('NONE', 'PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SellerSubscriptionPlan" AS ENUM ('PRO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SellerSubscriptionStatus" AS ENUM ('ACTIVE', 'CANCELED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "PaymentIntent" (
  "id" TEXT PRIMARY KEY,
  "userId" BIGINT NOT NULL,
  "wallet" "PaymentWallet" NOT NULL,
  "provider" "PaymentProviderCode" NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "currency" VARCHAR(8) NOT NULL DEFAULT 'RUB',
  "status" "PaymentIntentStatus" NOT NULL DEFAULT 'CREATED',
  "idempotencyKey" VARCHAR(120) NOT NULL,
  "providerRef" VARCHAR(191),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "succeededAt" TIMESTAMP(3),
  CONSTRAINT "PaymentIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentIntent_idempotencyKey_key" ON "PaymentIntent"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "PaymentIntent_userId_status_createdAt_idx" ON "PaymentIntent"("userId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "PaymentIntent_provider_status_idx" ON "PaymentIntent"("provider", "status");

CREATE TABLE IF NOT EXISTS "DepositLedgerEntry" (
  "id" BIGSERIAL PRIMARY KEY,
  "userId" BIGINT NOT NULL,
  "type" "DepositLedgerType" NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "availableAfterCents" BIGINT NOT NULL,
  "lockedAfterCents" BIGINT NOT NULL,
  "orderId" BIGINT,
  "lockId" TEXT,
  "paymentIntentId" VARCHAR(64),
  "idempotencyKey" VARCHAR(120) NOT NULL,
  "description" VARCHAR(500),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DepositLedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "DepositLedgerEntry_idempotencyKey_key" ON "DepositLedgerEntry"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "DepositLedgerEntry_userId_createdAt_idx" ON "DepositLedgerEntry"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "DepositLedgerEntry_orderId_idx" ON "DepositLedgerEntry"("orderId");

CREATE TABLE IF NOT EXISTS "DepositLock" (
  "id" TEXT PRIMARY KEY,
  "userId" BIGINT NOT NULL,
  "orderId" BIGINT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "status" "DepositLockStatus" NOT NULL DEFAULT 'ACTIVE',
  "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "unlockAt" TIMESTAMP(3) NOT NULL,
  "releasedAt" TIMESTAMP(3),
  CONSTRAINT "DepositLock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DepositLock_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "DepositLock_orderId_key" ON "DepositLock"("orderId");
CREATE INDEX IF NOT EXISTS "DepositLock_userId_status_idx" ON "DepositLock"("userId", "status");
CREATE INDEX IF NOT EXISTS "DepositLock_status_unlockAt_idx" ON "DepositLock"("status", "unlockAt");

CREATE TABLE IF NOT EXISTS "TrustHistoryEvent" (
  "id" BIGSERIAL PRIMARY KEY,
  "userId" BIGINT NOT NULL,
  "type" "TrustHistoryType" NOT NULL,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrustHistoryEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "TrustHistoryEvent_userId_createdAt_idx" ON "TrustHistoryEvent"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "TrustHistoryEvent_type_createdAt_idx" ON "TrustHistoryEvent"("type", "createdAt");

CREATE TABLE IF NOT EXISTS "SellerVerification" (
  "id" TEXT PRIMARY KEY,
  "userId" BIGINT NOT NULL,
  "kind" "SellerVerificationKind" NOT NULL,
  "status" "SellerVerificationStatus" NOT NULL DEFAULT 'NONE',
  "evidenceHash" VARCHAR(64),
  "providerRef" VARCHAR(191),
  "reviewedById" BIGINT,
  "verifiedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SellerVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "SellerVerification_userId_kind_key" ON "SellerVerification"("userId", "kind");
CREATE INDEX IF NOT EXISTS "SellerVerification_status_kind_idx" ON "SellerVerification"("status", "kind");

CREATE TABLE IF NOT EXISTS "SellerSubscription" (
  "id" TEXT PRIMARY KEY,
  "userId" BIGINT NOT NULL,
  "plan" "SellerSubscriptionPlan" NOT NULL DEFAULT 'PRO',
  "status" "SellerSubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endsAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SellerSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "SellerSubscription_userId_key" ON "SellerSubscription"("userId");
CREATE INDEX IF NOT EXISTS "SellerSubscription_status_endsAt_idx" ON "SellerSubscription"("status", "endsAt");

CREATE TABLE IF NOT EXISTS "ProductViewUnique" (
  "id" TEXT PRIMARY KEY,
  "productId" TEXT NOT NULL,
  "sellerId" BIGINT NOT NULL,
  "viewerKey" VARCHAR(96) NOT NULL,
  "viewerUserId" BIGINT,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductViewUnique_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProductViewUnique_viewerUserId_fkey" FOREIGN KEY ("viewerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProductViewUnique_productId_viewerKey_key" ON "ProductViewUnique"("productId", "viewerKey");
CREATE INDEX IF NOT EXISTS "ProductViewUnique_sellerId_firstSeenAt_idx" ON "ProductViewUnique"("sellerId", "firstSeenAt");
CREATE INDEX IF NOT EXISTS "ProductViewUnique_productId_firstSeenAt_idx" ON "ProductViewUnique"("productId", "firstSeenAt");

CREATE TABLE IF NOT EXISTS "SellerAnalyticsDaily" (
  "id" TEXT PRIMARY KEY,
  "sellerId" BIGINT NOT NULL,
  "day" DATE NOT NULL,
  "revenueCents" BIGINT NOT NULL DEFAULT 0,
  "profitCents" BIGINT NOT NULL DEFAULT 0,
  "ordersCount" INTEGER NOT NULL DEFAULT 0,
  "completedCount" INTEGER NOT NULL DEFAULT 0,
  "uniqueViews" INTEGER NOT NULL DEFAULT 0,
  "favoritesAdded" INTEGER NOT NULL DEFAULT 0,
  "repeatBuyers" INTEGER NOT NULL DEFAULT 0,
  "impressions" INTEGER NOT NULL DEFAULT 0,
  "clicks" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SellerAnalyticsDaily_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "SellerAnalyticsDaily_sellerId_day_key" ON "SellerAnalyticsDaily"("sellerId", "day");
CREATE INDEX IF NOT EXISTS "SellerAnalyticsDaily_sellerId_day_idx" ON "SellerAnalyticsDaily"("sellerId", "day");
