-- Expand-only marketplace TZ: warranty, shadow listings, review hide, appeals, Google-only users.

ALTER TABLE "User" ALTER COLUMN "telegramId" DROP NOT NULL;

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "warrantyHours" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "shadowBannedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Product_status_shadowBannedAt_createdAt_idx"
  ON "Product"("status", "shadowBannedAt", "createdAt");
CREATE INDEX IF NOT EXISTS "Product_warrantyHours_idx"
  ON "Product"("warrantyHours");

ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS "hiddenAt" TIMESTAMP(3);
ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS "hiddenReason" VARCHAR(20);

CREATE INDEX IF NOT EXISTS "Review_subjectId_hiddenAt_idx"
  ON "Review"("subjectId", "hiddenAt");

ALTER TABLE "UserReport" ADD COLUMN IF NOT EXISTS "reviewId" BIGINT;

CREATE INDEX IF NOT EXISTS "UserReport_reviewId_idx"
  ON "UserReport"("reviewId");

DO $$
BEGIN
  ALTER TABLE "UserReport"
    ADD CONSTRAINT "UserReport_reviewId_fkey"
    FOREIGN KEY ("reviewId") REFERENCES "Review"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
