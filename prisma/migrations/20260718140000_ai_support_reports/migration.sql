-- AI support requests reuse UserReport inbox (жалобы) with kind + admin reply.
ALTER TABLE "UserReport" ADD COLUMN IF NOT EXISTS "kind" VARCHAR(20) NOT NULL DEFAULT 'USER';
ALTER TABLE "UserReport" ADD COLUMN IF NOT EXISTS "adminReply" VARCHAR(2000);
ALTER TABLE "UserReport" ADD COLUMN IF NOT EXISTS "repliedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "UserReport_kind_closedAt_createdAt_idx"
  ON "UserReport"("kind", "closedAt", "createdAt");
