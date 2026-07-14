-- Phase 1: ONIX Auth platform additive schema + IdentityLink backfill
-- Non-destructive: keeps User.telegramId; does not change Mini App contract.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "permissionVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "securityScore" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "securityScoreAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "mergedIntoUserId" BIGINT;

CREATE TYPE "AuthProvider" AS ENUM ('TELEGRAM', 'GOOGLE', 'APPLE', 'DISCORD', 'STEAM', 'VK', 'EMAIL', 'PASSKEY');
CREATE TYPE "SessionRevokeReason" AS ENUM ('LOGOUT', 'LOGOUT_ALL', 'SESSION_LIMIT', 'ADMIN', 'REFRESH_REUSE', 'RISK_ENGINE', 'SESSION_VERSION', 'EXPIRED', 'SECURITY');
CREATE TYPE "AuthAuditAction" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAILED', 'REFRESH', 'LOGOUT', 'PASSWORD_RESET', 'IDENTITY_LINK', 'IDENTITY_UNLINK', 'SESSION_REVOKED', 'ADMIN_LOGIN_AS_USER', 'MFA_CHALLENGE_ISSUED', 'MFA_CHALLENGE_PASSED', 'MFA_CHALLENGE_FAILED', 'SESSION_VERSION_BUMP');
CREATE TYPE "IdentityHistoryAction" AS ENUM ('LINKED', 'UNLINKED', 'RELINKED', 'PROFILE_REFRESHED', 'PRIMARY_CHANGED', 'RECOVERY_MARKED');
CREATE TYPE "SecurityEventType" AS ENUM ('REFRESH_REUSE', 'REFRESH_TOKEN_THEFT', 'BRUTEFORCE', 'TOO_MANY_LOGINS', 'IMPOSSIBLE_TRAVEL', 'SESSION_ANOMALY', 'ACCOUNT_TAKEOVER_SUSPECTED');
CREATE TYPE "SecurityEventStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'AUTO_MITIGATED');
CREATE TYPE "MfaMethod" AS ENUM ('TELEGRAM', 'TOTP', 'EMAIL', 'PASSKEY');
CREATE TYPE "SigningKeyStatus" AS ENUM ('CURRENT', 'PREVIOUS', 'RETIRED');
CREATE TYPE "AccountMergeStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELED', 'FAILED');

CREATE TABLE "IdentityLink" (
  "id" TEXT NOT NULL,
  "userId" BIGINT NOT NULL,
  "provider" "AuthProvider" NOT NULL,
  "providerUserId" VARCHAR(191) NOT NULL,
  "username" VARCHAR(128),
  "email" VARCHAR(320),
  "displayName" VARCHAR(191),
  "avatarUrl" VARCHAR(500),
  "profileSnapshot" JSONB,
  "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "IdentityLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IdentityLink_provider_providerUserId_key" ON "IdentityLink"("provider", "providerUserId");
CREATE INDEX "IdentityLink_userId_deletedAt_idx" ON "IdentityLink"("userId", "deletedAt");
CREATE INDEX "IdentityLink_provider_deletedAt_idx" ON "IdentityLink"("provider", "deletedAt");

ALTER TABLE "IdentityLink"
  ADD CONSTRAINT "IdentityLink_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Session" (
  "id" TEXT NOT NULL,
  "userId" BIGINT NOT NULL,
  "familyId" VARCHAR(64) NOT NULL,
  "clientType" VARCHAR(32) NOT NULL DEFAULT 'WEB',
  "refreshGeneration" INTEGER NOT NULL DEFAULT 0,
  "refreshTokenHash" VARCHAR(64) NOT NULL,
  "previousRefreshHash" VARCHAR(64),
  "lockVersion" INTEGER NOT NULL DEFAULT 0,
  "riskScore" INTEGER NOT NULL DEFAULT 0,
  "riskUpdatedAt" TIMESTAMP(3),
  "rememberMe" BOOLEAN NOT NULL DEFAULT false,
  "deviceName" VARCHAR(120),
  "browser" VARCHAR(64),
  "os" VARCHAR(64),
  "platform" VARCHAR(64),
  "timezone" VARCHAR(64),
  "language" VARCHAR(32),
  "userAgent" VARCHAR(512),
  "fingerprintHash" VARCHAR(64),
  "screenResolution" VARCHAR(32),
  "webglHash" VARCHAR(64),
  "canvasHash" VARCHAR(64),
  "ipAddress" VARCHAR(64),
  "asn" INTEGER,
  "country" VARCHAR(2),
  "city" VARCHAR(120),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
  "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "revokeReason" "SessionRevokeReason",
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Session_refreshTokenHash_key" ON "Session"("refreshTokenHash");
CREATE INDEX "Session_userId_revokedAt_lastSeenAt_idx" ON "Session"("userId", "revokedAt", "lastSeenAt");
CREATE INDEX "Session_refreshExpiresAt_idx" ON "Session"("refreshExpiresAt");
CREATE INDEX "Session_fingerprintHash_idx" ON "Session"("fingerprintHash");
CREATE INDEX "Session_familyId_idx" ON "Session"("familyId");

ALTER TABLE "Session"
  ADD CONSTRAINT "Session_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AuthAuditLog" (
  "id" BIGSERIAL NOT NULL,
  "userId" BIGINT,
  "sessionId" TEXT,
  "action" "AuthAuditAction" NOT NULL,
  "provider" "AuthProvider",
  "ipAddress" VARCHAR(64),
  "country" VARCHAR(2),
  "userAgent" VARCHAR(512),
  "fingerprint" VARCHAR(64),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuthAuditLog_userId_createdAt_idx" ON "AuthAuditLog"("userId", "createdAt");
CREATE INDEX "AuthAuditLog_action_createdAt_idx" ON "AuthAuditLog"("action", "createdAt");

CREATE TABLE "IdentityHistory" (
  "id" BIGSERIAL NOT NULL,
  "userId" BIGINT NOT NULL,
  "provider" "AuthProvider" NOT NULL,
  "providerUserId" VARCHAR(191) NOT NULL,
  "action" "IdentityHistoryAction" NOT NULL,
  "identityLinkId" TEXT,
  "actorUserId" BIGINT,
  "ipAddress" VARCHAR(64),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IdentityHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IdentityHistory_userId_createdAt_idx" ON "IdentityHistory"("userId", "createdAt");
CREATE INDEX "IdentityHistory_provider_providerUserId_idx" ON "IdentityHistory"("provider", "providerUserId");

CREATE TABLE "SecurityEvent" (
  "id" BIGSERIAL NOT NULL,
  "type" "SecurityEventType" NOT NULL,
  "status" "SecurityEventStatus" NOT NULL DEFAULT 'OPEN',
  "userId" BIGINT,
  "sessionId" TEXT,
  "severity" INTEGER NOT NULL DEFAULT 50,
  "ipAddress" VARCHAR(64),
  "country" VARCHAR(2),
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SecurityEvent_status_createdAt_idx" ON "SecurityEvent"("status", "createdAt");
CREATE INDEX "SecurityEvent_userId_createdAt_idx" ON "SecurityEvent"("userId", "createdAt");
CREATE INDEX "SecurityEvent_type_createdAt_idx" ON "SecurityEvent"("type", "createdAt");

CREATE TABLE "Role" (
  "id" TEXT NOT NULL,
  "code" VARCHAR(64) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

CREATE TABLE "Permission" (
  "id" TEXT NOT NULL,
  "code" VARCHAR(120) NOT NULL,
  "description" VARCHAR(255),
  CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

CREATE TABLE "RolePermission" (
  "roleId" TEXT NOT NULL,
  "permissionId" TEXT NOT NULL,
  CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId", "permissionId")
);
ALTER TABLE "RolePermission"
  ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "UserRole" (
  "userId" BIGINT NOT NULL,
  "roleId" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assignedBy" BIGINT,
  CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId", "roleId")
);
ALTER TABLE "UserRole"
  ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TrustedDevice" (
  "id" TEXT NOT NULL,
  "userId" BIGINT NOT NULL,
  "fingerprintHash" VARCHAR(64) NOT NULL,
  "deviceName" VARCHAR(120),
  "browser" VARCHAR(64),
  "os" VARCHAR(64),
  "trustedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "trustSource" VARCHAR(32) NOT NULL,
  CONSTRAINT "TrustedDevice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TrustedDevice_userId_fingerprintHash_key" ON "TrustedDevice"("userId", "fingerprintHash");
CREATE INDEX "TrustedDevice_userId_revokedAt_idx" ON "TrustedDevice"("userId", "revokedAt");
ALTER TABLE "TrustedDevice"
  ADD CONSTRAINT "TrustedDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MfaFactor" (
  "id" TEXT NOT NULL,
  "userId" BIGINT NOT NULL,
  "method" "MfaMethod" NOT NULL,
  "label" VARCHAR(120),
  "secretRef" VARCHAR(255),
  "verifiedAt" TIMESTAMP(3),
  "disabledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MfaFactor_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MfaFactor_userId_idx" ON "MfaFactor"("userId");
ALTER TABLE "MfaFactor"
  ADD CONSTRAINT "MfaFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MfaChallenge" (
  "id" TEXT NOT NULL,
  "userId" BIGINT NOT NULL,
  "sessionId" TEXT,
  "method" "MfaMethod" NOT NULL,
  "status" VARCHAR(32) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MfaChallenge_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MfaChallenge_userId_status_idx" ON "MfaChallenge"("userId", "status");
ALTER TABLE "MfaChallenge"
  ADD CONSTRAINT "MfaChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SigningKey" (
  "id" TEXT NOT NULL,
  "kid" VARCHAR(64) NOT NULL,
  "algorithm" VARCHAR(32) NOT NULL DEFAULT 'EdDSA',
  "publicKey" TEXT NOT NULL,
  "privateKeyRef" VARCHAR(255) NOT NULL,
  "status" "SigningKeyStatus" NOT NULL DEFAULT 'CURRENT',
  "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retiredAt" TIMESTAMP(3),
  CONSTRAINT "SigningKey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SigningKey_kid_key" ON "SigningKey"("kid");

CREATE TABLE "AccountMergeRequest" (
  "id" TEXT NOT NULL,
  "survivorUserId" BIGINT NOT NULL,
  "absorbedUserId" BIGINT NOT NULL,
  "status" "AccountMergeStatus" NOT NULL DEFAULT 'PENDING',
  "evidence" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "AccountMergeRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AccountMergeRequest_survivorUserId_idx" ON "AccountMergeRequest"("survivorUserId");
CREATE INDEX "AccountMergeRequest_absorbedUserId_idx" ON "AccountMergeRequest"("absorbedUserId");
CREATE INDEX "AccountMergeRequest_status_idx" ON "AccountMergeRequest"("status");

CREATE TABLE "IdempotencyRecord" (
  "id" TEXT NOT NULL,
  "key" VARCHAR(128) NOT NULL,
  "userId" BIGINT,
  "route" VARCHAR(191) NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "responseCode" INTEGER,
  "responseBody" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IdempotencyRecord_key_route_key" ON "IdempotencyRecord"("key", "route");
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- Idempotent backfill: one TELEGRAM IdentityLink per User with telegramId
INSERT INTO "IdentityLink" (
  "id", "userId", "provider", "providerUserId", "username", "displayName", "avatarUrl", "linkedAt", "lastUsedAt"
)
SELECT
  md5('tg:' || "id"::text || ':' || "telegramId"::text),
  "id",
  'TELEGRAM'::"AuthProvider",
  "telegramId"::text,
  "telegramNick",
  "displayName",
  "avatarUrl",
  COALESCE("createdAt", CURRENT_TIMESTAMP),
  "lastLoginAt"
FROM "User"
WHERE "telegramId" IS NOT NULL
ON CONFLICT ("provider", "providerUserId") DO NOTHING;

INSERT INTO "IdentityHistory" ("userId", "provider", "providerUserId", "action", "identityLinkId", "metadata")
SELECT
  l."userId",
  l."provider",
  l."providerUserId",
  'LINKED'::"IdentityHistoryAction",
  l."id",
  jsonb_build_object('source', 'phase1_backfill')
FROM "IdentityLink" l
WHERE l."provider" = 'TELEGRAM'
  AND NOT EXISTS (
    SELECT 1 FROM "IdentityHistory" h
    WHERE h."userId" = l."userId"
      AND h."provider" = l."provider"
      AND h."providerUserId" = l."providerUserId"
      AND h."action" = 'LINKED'
  );
