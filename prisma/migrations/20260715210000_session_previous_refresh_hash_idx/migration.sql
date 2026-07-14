-- Phase 3 audit remediation (M1): index Session.previousRefreshHash for refresh-reuse lookup.
-- Query: Session.findFirst({ where: { previousRefreshHash } }) in SessionService.handleRefreshReuse path.

CREATE INDEX IF NOT EXISTS "Session_previousRefreshHash_idx" ON "Session"("previousRefreshHash");
