CREATE TYPE "AbuseMarkerKind" AS ENUM ('FINGERPRINT', 'BROWSER_ID', 'IP', 'USER_AGENT');
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'REGISTRATION_BLOCKED';
CREATE TABLE IF NOT EXISTS "AbuseMarker" (
  "id" TEXT PRIMARY KEY,
  "kind" "AbuseMarkerKind" NOT NULL,
  "valueHash" VARCHAR(64) NOT NULL,
  "sourceUserId" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "AbuseMarker_kind_valueHash_key" ON "AbuseMarker"("kind", "valueHash");
CREATE INDEX IF NOT EXISTS "AbuseMarker_kind_valueHash_revokedAt_idx" ON "AbuseMarker"("kind", "valueHash", "revokedAt");
CREATE INDEX IF NOT EXISTS "AbuseMarker_sourceUserId_revokedAt_idx" ON "AbuseMarker"("sourceUserId", "revokedAt");
