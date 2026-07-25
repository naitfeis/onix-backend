-- Slice 4: LedgerEntry actor / source / correlationId + velocity index

CREATE TYPE "LedgerSource" AS ENUM ('USER', 'ADMIN', 'SYSTEM', 'WORKER', 'PAYMENT_PROVIDER', 'AI');

ALTER TABLE "LedgerEntry"
  ADD COLUMN IF NOT EXISTS "actorUserId" BIGINT,
  ADD COLUMN IF NOT EXISTS "source" "LedgerSource" NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN IF NOT EXISTS "correlationId" VARCHAR(64);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'LedgerEntry_actorUserId_fkey'
  ) THEN
    ALTER TABLE "LedgerEntry"
      ADD CONSTRAINT "LedgerEntry_actorUserId_fkey"
      FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "LedgerEntry_userId_type_createdAt_idx"
  ON "LedgerEntry"("userId", "type", "createdAt");
