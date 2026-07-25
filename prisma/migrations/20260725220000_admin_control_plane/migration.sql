-- Slice 6 — Admin Control Plane (separate auth boundary)

DO $$ BEGIN
  CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'SECURITY_ADMIN', 'SUPPORT_ADMIN', 'FINANCE_ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "AdminUser" (
  "id" BIGSERIAL PRIMARY KEY,
  "email" VARCHAR(191) NOT NULL,
  "passwordHash" VARCHAR(255) NOT NULL,
  "role" "AdminRole" NOT NULL,
  "telegramId" BIGINT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastLoginAt" TIMESTAMP(3)
);

CREATE UNIQUE INDEX IF NOT EXISTS "AdminUser_email_key" ON "AdminUser"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "AdminUser_telegramId_key" ON "AdminUser"("telegramId");

CREATE TABLE IF NOT EXISTS "AdminSession" (
  "id" TEXT PRIMARY KEY,
  "adminUserId" BIGINT NOT NULL,
  "refreshTokenHash" VARCHAR(64) NOT NULL,
  "ipHash" VARCHAR(64),
  "userAgent" VARCHAR(512),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "AdminSession_adminUserId_fkey"
    FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "AdminSession_refreshTokenHash_key" ON "AdminSession"("refreshTokenHash");
CREATE INDEX IF NOT EXISTS "AdminSession_adminUserId_revokedAt_idx" ON "AdminSession"("adminUserId", "revokedAt");
CREATE INDEX IF NOT EXISTS "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");

CREATE TABLE IF NOT EXISTS "AdminMfaChallenge" (
  "id" TEXT PRIMARY KEY,
  "adminUserId" BIGINT NOT NULL,
  "codeHash" VARCHAR(64) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminMfaChallenge_adminUserId_fkey"
    FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "AdminMfaChallenge_adminUserId_expiresAt_idx"
  ON "AdminMfaChallenge"("adminUserId", "expiresAt");

CREATE TABLE IF NOT EXISTS "AdminActionLog" (
  "id" BIGSERIAL PRIMARY KEY,
  "adminUserId" BIGINT NOT NULL,
  "action" VARCHAR(64) NOT NULL,
  "targetType" VARCHAR(64),
  "targetId" VARCHAR(64),
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminActionLog_adminUserId_fkey"
    FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "AdminActionLog_adminUserId_createdAt_idx"
  ON "AdminActionLog"("adminUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "AdminActionLog_action_createdAt_idx"
  ON "AdminActionLog"("action", "createdAt");
