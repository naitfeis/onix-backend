-- Slice 3: MFA step-up — bind challenges to purpose + opaque metadata
ALTER TABLE "MfaChallenge" ADD COLUMN IF NOT EXISTS "purpose" VARCHAR(64) NOT NULL DEFAULT 'WITHDRAW';
ALTER TABLE "MfaChallenge" ADD COLUMN IF NOT EXISTS "metadata" JSONB;

CREATE INDEX IF NOT EXISTS "MfaChallenge_status_expiresAt_idx" ON "MfaChallenge"("status", "expiresAt");
