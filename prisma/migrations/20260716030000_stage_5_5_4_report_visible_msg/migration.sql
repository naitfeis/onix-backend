-- HOTFIX 5.5.4: buyer-only auto-delivery messages + user reports + longer SYSTEM text
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "visibleToUserId" BIGINT;
ALTER TABLE "Message" ALTER COLUMN "text" TYPE VARCHAR(4500);

CREATE INDEX IF NOT EXISTS "Message_visibleToUserId_idx" ON "Message"("visibleToUserId");

DO $$ BEGIN
  ALTER TABLE "Message"
    ADD CONSTRAINT "Message_visibleToUserId_fkey"
    FOREIGN KEY ("visibleToUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "UserReport" (
  "id" TEXT NOT NULL,
  "reporterId" BIGINT NOT NULL,
  "targetId" BIGINT NOT NULL,
  "reason" "BanReason" NOT NULL,
  "comment" VARCHAR(1000) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UserReport_targetId_createdAt_idx" ON "UserReport"("targetId", "createdAt");
CREATE INDEX IF NOT EXISTS "UserReport_reporterId_createdAt_idx" ON "UserReport"("reporterId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "UserReport"
    ADD CONSTRAINT "UserReport_reporterId_fkey"
    FOREIGN KEY ("reporterId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "UserReport"
    ADD CONSTRAINT "UserReport_targetId_fkey"
    FOREIGN KEY ("targetId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
