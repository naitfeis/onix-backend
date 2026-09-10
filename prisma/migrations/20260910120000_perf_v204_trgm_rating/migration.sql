-- v2.0.4 perf: trigram search + seller rating sort indexes.
-- IF NOT EXISTS — safe on re-apply. No CONCURRENTLY (Prisma wraps migrations in a transaction).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Product_title_trgm_idx"
  ON "Product" USING gin ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "User_displayName_trgm_idx"
  ON "User" USING gin ("displayName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Chat_title_trgm_idx"
  ON "Chat" USING gin ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "User_ratingAverage_ratingCount_idx"
  ON "User" ("ratingAverage" DESC, "ratingCount" DESC);

CREATE INDEX IF NOT EXISTS "Product_status_warrantyHours_idx"
  ON "Product" ("status", "warrantyHours" DESC);
