-- Performance 2026: indexes for real hot paths (marketplace, chats, escrow, follows).
-- IF NOT EXISTS — safe on re-apply. No CONCURRENTLY (Prisma wraps migrations in a transaction).

CREATE INDEX IF NOT EXISTS "Follow_sellerId_idx" ON "Follow"("sellerId");

CREATE INDEX IF NOT EXISTS "Product_status_createdAt_idx" ON "Product"("status", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "Product_status_priceCents_idx" ON "Product"("status", "priceCents");

CREATE INDEX IF NOT EXISTS "Order_buyerId_createdAt_idx" ON "Order"("buyerId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "Order_sellerId_createdAt_idx" ON "Order"("sellerId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "Order_chatId_createdAt_idx" ON "Order"("chatId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "Chat_updatedAt_idx" ON "Chat"("updatedAt" DESC);

CREATE INDEX IF NOT EXISTS "Message_chatId_user_createdAt_idx"
  ON "Message"("chatId", "createdAt")
  WHERE "kind" = 'USER' AND "senderId" IS NOT NULL;
