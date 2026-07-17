-- User reports can be closed by staff; sellers can be blocked from listing.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sellBannedAt" TIMESTAMP(3);

ALTER TABLE "UserReport" ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3);
ALTER TABLE "UserReport" ADD COLUMN IF NOT EXISTS "closedById" BIGINT;

CREATE INDEX IF NOT EXISTS "UserReport_closedAt_createdAt_idx" ON "UserReport"("closedAt", "createdAt");
