-- Slice 4.1: LedgerEntry fundKind / saleKind for withdraw provenance

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LedgerFundKind') THEN
    CREATE TYPE "LedgerFundKind" AS ENUM ('USER_OWNED', 'SALE_PROCEEDS', 'SYSTEM');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LedgerSaleKind') THEN
    CREATE TYPE "LedgerSaleKind" AS ENUM ('ACCOUNT', 'OTHER');
  END IF;
END $$;

ALTER TABLE "LedgerEntry"
  ADD COLUMN IF NOT EXISTS "fundKind" "LedgerFundKind" NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN IF NOT EXISTS "saleKind" "LedgerSaleKind";

CREATE INDEX IF NOT EXISTS "LedgerEntry_userId_fundKind_createdAt_idx"
  ON "LedgerEntry"("userId", "fundKind", "createdAt");
