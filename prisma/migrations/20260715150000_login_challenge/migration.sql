-- ONIX Identity Platform Phase D — LoginChallenge (additive only)
CREATE TYPE "LoginChallengeStatus" AS ENUM ('CREATED', 'OPENED', 'CONFIRMED', 'CONSUMED', 'EXPIRED');

CREATE TABLE "LoginChallenge" (
    "id" TEXT NOT NULL,
    "nonce" VARCHAR(64) NOT NULL,
    "browserFingerprintHash" VARCHAR(64),
    "loginSessionId" VARCHAR(64) NOT NULL,
    "status" "LoginChallengeStatus" NOT NULL DEFAULT 'CREATED',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "telegramId" BIGINT,
    "telegramUsername" VARCHAR(64),
    "telegramFirstName" VARCHAR(120),
    "telegramLastName" VARCHAR(120),
    "telegramPhotoUrl" VARCHAR(500),
    "confirmedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "exchangeCodeHash" VARCHAR(64),
    "exchangeExpiresAt" TIMESTAMP(3),
    "createdIp" VARCHAR(64),
    "createdUserAgent" VARCHAR(512),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoginChallenge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LoginChallenge_nonce_key" ON "LoginChallenge"("nonce");
CREATE UNIQUE INDEX "LoginChallenge_exchangeCodeHash_key" ON "LoginChallenge"("exchangeCodeHash");
CREATE INDEX "LoginChallenge_loginSessionId_status_idx" ON "LoginChallenge"("loginSessionId", "status");
CREATE INDEX "LoginChallenge_status_expiresAt_idx" ON "LoginChallenge"("status", "expiresAt");
CREATE INDEX "LoginChallenge_telegramId_idx" ON "LoginChallenge"("telegramId");
