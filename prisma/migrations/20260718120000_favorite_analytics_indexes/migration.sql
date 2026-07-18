-- Analytics favorites rollup: filter by createdAt + join Product.sellerId
CREATE INDEX IF NOT EXISTS "Favorite_productId_createdAt_idx" ON "Favorite"("productId", "createdAt");
CREATE INDEX IF NOT EXISTS "Favorite_createdAt_idx" ON "Favorite"("createdAt");
