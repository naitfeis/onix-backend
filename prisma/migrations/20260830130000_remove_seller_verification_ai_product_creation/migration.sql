-- Expand phase only: the retired runtime no longer uses these objects, but they
-- must remain available while old application instances may still be running.
-- Destructive cleanup is deliberately kept out of automatic migrations. Run
-- prisma/manual-post-rollout/20260830130000_retired_flows_contract.sql only in
-- a later release after the rollout and backup/count preflight are complete.
-- TrustHistoryType is intentionally unchanged so historical events stay readable.

ALTER TABLE "User"
  ALTER COLUMN "trustScoreVersion" SET DEFAULT 2;

UPDATE "User"
SET "trustDirty" = true
WHERE "trustDirty" = false
   OR "trustScoreVersion" < 2;
