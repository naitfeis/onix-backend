-- PostgreSQL requires this statement to run outside an explicit transaction.
-- Prisma's PostgreSQL migration runner executes migration files without wrapping
-- them in a transaction, so CONCURRENTLY is safe for deploy-time traffic.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_sellerId_completedAt_idx"
  ON "Order"("sellerId", "completedAt");
