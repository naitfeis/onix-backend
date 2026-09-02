-- Automatic Security Lock + Support & Security Center + admin IP trust + bot chat recovery.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "securityLockedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "securityLockLevel" VARCHAR(16);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "securityLockReason" VARCHAR(500);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "securityCasePublicId" VARCHAR(32);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "withdrawBlockedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "suspiciousFundsHoldAt" TIMESTAMP(3);

ALTER TABLE "LoginChallenge" ADD COLUMN IF NOT EXISTS "telegramChatId" BIGINT;
CREATE INDEX IF NOT EXISTS "LoginChallenge_telegramChatId_status_createdAt_idx"
  ON "LoginChallenge"("telegramChatId", "status", "createdAt");

ALTER TYPE "SupportTicketStatus" ADD VALUE IF NOT EXISTS 'IN_REVIEW';
ALTER TYPE "SupportTicketStatus" ADD VALUE IF NOT EXISTS 'WAITING_USER';
ALTER TYPE "SupportTicketStatus" ADD VALUE IF NOT EXISTS 'RESOLVED';

CREATE TYPE "SupportTicketCategory" AS ENUM (
  'FRAUD_REPORT',
  'RISK_ENGINE',
  'BAN_EVASION',
  'ACCOUNT_SECURITY',
  'BAN_APPEAL',
  'SELL_BAN_APPEAL',
  'WITHDRAWAL_REVIEW',
  'CHAT_ABUSE',
  'SPAM',
  'HARASSMENT',
  'ORDER_DISPUTE',
  'REFUND_REQUEST',
  'ITEM_NOT_RECEIVED',
  'ITEM_NOT_AS_DESCRIBED',
  'ACCOUNT',
  'PAYMENT',
  'BUG',
  'OTHER'
);

CREATE TYPE "SupportTicketPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

ALTER TABLE "SupportTicket" ALTER COLUMN "orderId" DROP NOT NULL;
ALTER TABLE "SupportTicket" ALTER COLUMN "chatId" DROP NOT NULL;
ALTER TABLE "SupportTicket" ALTER COLUMN "openedById" DROP NOT NULL;

ALTER TABLE "SupportTicket" ADD COLUMN IF NOT EXISTS "publicNumber" SERIAL;
ALTER TABLE "SupportTicket" ADD COLUMN IF NOT EXISTS "reportedUserId" BIGINT;
ALTER TABLE "SupportTicket" ADD COLUMN IF NOT EXISTS "relatedListingId" TEXT;
ALTER TABLE "SupportTicket" ADD COLUMN IF NOT EXISTS "relatedRiskEventId" BIGINT;
ALTER TABLE "SupportTicket" ADD COLUMN IF NOT EXISTS "relatedSecurityEventId" BIGINT;
ALTER TABLE "SupportTicket" ADD COLUMN IF NOT EXISTS "category" "SupportTicketCategory" NOT NULL DEFAULT 'OTHER';
ALTER TABLE "SupportTicket" ADD COLUMN IF NOT EXISTS "priority" "SupportTicketPriority" NOT NULL DEFAULT 'MEDIUM';
ALTER TABLE "SupportTicket" ADD COLUMN IF NOT EXISTS "subject" VARCHAR(240);
ALTER TABLE "SupportTicket" ADD COLUMN IF NOT EXISTS "body" TEXT;
ALTER TABLE "SupportTicket" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "SupportTicket_publicNumber_key" ON "SupportTicket"("publicNumber");
CREATE INDEX IF NOT EXISTS "SupportTicket_category_status_createdAt_idx" ON "SupportTicket"("category", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "SupportTicket_priority_status_createdAt_idx" ON "SupportTicket"("priority", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "SupportTicket_reportedUserId_createdAt_idx" ON "SupportTicket"("reportedUserId", "createdAt");

ALTER TABLE "SupportTicket"
  ADD CONSTRAINT "SupportTicket_reportedUserId_fkey"
  FOREIGN KEY ("reportedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SupportTicketEvent" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "kind" VARCHAR(64) NOT NULL,
  "message" VARCHAR(1000) NOT NULL,
  "actorUserId" BIGINT,
  "actorAdminId" BIGINT,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportTicketEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupportTicketEvent_ticketId_createdAt_idx" ON "SupportTicketEvent"("ticketId", "createdAt");

ALTER TABLE "SupportTicketEvent"
  ADD CONSTRAINT "SupportTicketEvent_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupportTicketEvent"
  ADD CONSTRAINT "SupportTicketEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'BAN_EVASION';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'OFF_PLATFORM_PAYMENT';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'EXTERNAL_CONTACT';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'SPAM';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'DUPLICATE_LISTING';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'SUSPICIOUS_LINK';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'FRAUD_ATTEMPT';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'SECURITY_LOCK';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'HIGH_RISK_THRESHOLD';

ALTER TYPE "AbuseMarkerKind" ADD VALUE IF NOT EXISTS 'TELEGRAM_ID';
ALTER TYPE "AbuseMarkerKind" ADD VALUE IF NOT EXISTS 'PHONE_HASH';
ALTER TYPE "AbuseMarkerKind" ADD VALUE IF NOT EXISTS 'VK_ID';

CREATE TABLE "AdminTrustedIp" (
  "id" TEXT NOT NULL,
  "adminUserId" BIGINT NOT NULL,
  "ipHash" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminTrustedIp_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminTrustedIp_adminUserId_ipHash_key" ON "AdminTrustedIp"("adminUserId", "ipHash");
CREATE INDEX "AdminTrustedIp_ipHash_expiresAt_idx" ON "AdminTrustedIp"("ipHash", "expiresAt");

ALTER TABLE "AdminTrustedIp"
  ADD CONSTRAINT "AdminTrustedIp_adminUserId_fkey"
  FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
