-- Ledger types for Balance ↔ Deposit transfers
ALTER TYPE "LedgerEntryType" ADD VALUE IF NOT EXISTS 'DEPOSIT_FUND';
ALTER TYPE "LedgerEntryType" ADD VALUE IF NOT EXISTS 'DEPOSIT_RETURN';

-- Group chats
CREATE TYPE "ChatKind" AS ENUM ('DIRECT', 'GROUP');

ALTER TABLE "Chat" ADD COLUMN IF NOT EXISTS "kind" "ChatKind" NOT NULL DEFAULT 'DIRECT';
ALTER TABLE "Chat" ADD COLUMN IF NOT EXISTS "title" VARCHAR(120);

-- Soft-delete + hide-for-me
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "deletedById" BIGINT;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "deletedReason" VARCHAR(500);

DO $$ BEGIN
  ALTER TABLE "Message"
    ADD CONSTRAINT "Message_deletedById_fkey"
    FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "MessageHide" (
  "messageId" BIGINT NOT NULL,
  "userId" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MessageHide_pkey" PRIMARY KEY ("messageId", "userId"),
  CONSTRAINT "MessageHide_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MessageHide_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "MessageHide_userId_idx" ON "MessageHide"("userId");
CREATE INDEX IF NOT EXISTS "Message_deletedAt_idx" ON "Message"("deletedAt");
