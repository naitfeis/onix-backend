-- Soft-delete "for everyone" flag (audit retained)
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "deletedForAll" BOOLEAN NOT NULL DEFAULT false;
