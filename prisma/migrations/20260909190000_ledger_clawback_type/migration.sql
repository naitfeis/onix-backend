DO $$ BEGIN
  ALTER TYPE "LedgerEntryType" ADD VALUE 'CLAWBACK';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
