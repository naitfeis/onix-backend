-- ONIX backend foundation. Review and back up before applying.
-- This file is intentionally not executed by the implementation process.

CREATE TYPE "LedgerEntryType" AS ENUM ('DEPOSIT','PURCHASE_HOLD','REFUND','SALE_PAYOUT','ADMIN_ADJUSTMENT','WITHDRAWAL');
CREATE TYPE "NotificationType" AS ENUM ('NEW_PRODUCT','NEW_MESSAGE','ORDER_UPDATE','NEW_REVIEW','SYSTEM');
CREATE TYPE "ProductCategory" AS ENUM ('STANDOFF_2','STEAM','ROBLOX','RP_PROJECTS','BRAWL_STARS','OTHER');

ALTER TABLE "User"
  DROP COLUMN IF EXISTS "email",
  DROP COLUMN IF EXISTS "telegramToken",
  ADD COLUMN "onixId" VARCHAR(20),
  ADD COLUMN "displayName" VARCHAR(120),
  ADD COLUMN "avatarUrl" VARCHAR(500),
  ADD COLUMN "bio" VARCHAR(500),
  ADD COLUMN "balanceCents" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "ratingAverage" DECIMAL(3,2) NOT NULL DEFAULT 0,
  ADD COLUMN "ratingCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "completedSales" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "isAdmin" BOOLEAN NOT NULL DEFAULT false;

UPDATE "User" SET "onixId" = 'ONIX-' || lpad("id"::text, 6, '0') WHERE "onixId" IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "User" WHERE "telegramId" IS NULL) THEN
    RAISE EXCEPTION 'Migration stopped safely: users without telegramId require manual identity reconciliation';
  END IF;
END $$;

ALTER TABLE "User"
  ALTER COLUMN "telegramId" SET NOT NULL,
  ALTER COLUMN "onixId" SET NOT NULL,
  ALTER COLUMN "telegramNick" TYPE VARCHAR(64);
CREATE UNIQUE INDEX "User_onixId_key" ON "User"("onixId");

ALTER TABLE "Product" RENAME COLUMN "price" TO "legacyPrice";
ALTER TABLE "Product"
  ADD COLUMN "priceCents" BIGINT,
  ADD COLUMN "subcategory" VARCHAR(100),
  ADD COLUMN "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "expiresAt" TIMESTAMP(3);
UPDATE "Product"
SET "priceCents" = round("legacyPrice" * 100)::bigint,
    "expiresAt" = "createdAt" + interval '30 days';
ALTER TABLE "Product"
  ALTER COLUMN "priceCents" SET NOT NULL,
  ALTER COLUMN "expiresAt" SET NOT NULL,
  ALTER COLUMN "quantity" SET DEFAULT 1,
  DROP COLUMN "legacyPrice";
ALTER TABLE "Product" ALTER COLUMN "category" TYPE "ProductCategory" USING (
  CASE upper("category")
    WHEN 'STANDOFF 2' THEN 'STANDOFF_2'
    WHEN 'STANDOFF_2' THEN 'STANDOFF_2'
    WHEN 'STEAM' THEN 'STEAM'
    WHEN 'ROBLOX' THEN 'ROBLOX'
    WHEN 'RP ПРОЕКТЫ' THEN 'RP_PROJECTS'
    WHEN 'RP_PROJECTS' THEN 'RP_PROJECTS'
    WHEN 'BRAWL STARS' THEN 'BRAWL_STARS'
    WHEN 'BRAWL_STARS' THEN 'BRAWL_STARS'
    ELSE 'OTHER'
  END::"ProductCategory"
);
DROP INDEX IF EXISTS "Product_category_status_idx";
CREATE INDEX "Product_category_status_createdAt_idx" ON "Product"("category","status","createdAt");
CREATE INDEX "Product_sellerId_status_idx" ON "Product"("sellerId","status");
CREATE INDEX "Product_title_idx" ON "Product"("title");

ALTER TABLE "Order" RENAME COLUMN "totalAmount" TO "legacyTotalAmount";
ALTER TABLE "Order"
  ADD COLUMN "totalAmountCents" BIGINT,
  ADD COLUMN "feeCents" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "payoutCents" BIGINT,
  ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "idempotencyKey" VARCHAR(100),
  ADD COLUMN "disputeReason" VARCHAR(1000),
  ADD COLUMN "canceledAt" TIMESTAMP(3),
  ADD COLUMN "completedAt" TIMESTAMP(3);
UPDATE "Order"
SET "totalAmountCents" = round("legacyTotalAmount" * 100)::bigint,
    "payoutCents" = round("legacyTotalAmount" * 100)::bigint,
    "idempotencyKey" = 'legacy-order-' || "id"::text;
ALTER TABLE "Order"
  ALTER COLUMN "totalAmountCents" SET NOT NULL,
  ALTER COLUMN "payoutCents" SET NOT NULL,
  ALTER COLUMN "idempotencyKey" SET NOT NULL,
  DROP COLUMN "legacyTotalAmount";
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");
CREATE INDEX "Order_buyerId_status_idx" ON "Order"("buyerId","status");
CREATE INDEX "Order_sellerId_status_idx" ON "Order"("sellerId","status");

CREATE TABLE "Favorite" (
  "userId" BIGINT NOT NULL, "productId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Favorite_pkey" PRIMARY KEY ("userId","productId"),
  CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "Favorite_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE
);
CREATE TABLE "Follow" (
  "followerId" BIGINT NOT NULL, "sellerId" BIGINT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Follow_pkey" PRIMARY KEY ("followerId","sellerId"),
  CONSTRAINT "Follow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "Follow_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE TABLE "OrderTransition" (
  "id" BIGSERIAL PRIMARY KEY, "orderId" BIGINT NOT NULL, "from" "OrderStatus", "to" "OrderStatus" NOT NULL,
  "actorId" BIGINT, "idempotencyKey" VARCHAR(120), "reason" VARCHAR(1000), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderTransition_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "OrderTransition_idempotencyKey_key" ON "OrderTransition"("idempotencyKey");
CREATE INDEX "OrderTransition_orderId_createdAt_idx" ON "OrderTransition"("orderId","createdAt");
CREATE TABLE "LedgerEntry" (
  "id" BIGSERIAL PRIMARY KEY, "userId" BIGINT NOT NULL, "orderId" BIGINT, "type" "LedgerEntryType" NOT NULL,
  "amountCents" BIGINT NOT NULL, "balanceAfterCents" BIGINT NOT NULL, "idempotencyKey" VARCHAR(120) NOT NULL,
  "description" VARCHAR(500), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id"),
  CONSTRAINT "LedgerEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id")
);
CREATE UNIQUE INDEX "LedgerEntry_idempotencyKey_key" ON "LedgerEntry"("idempotencyKey");
CREATE INDEX "LedgerEntry_userId_createdAt_idx" ON "LedgerEntry"("userId","createdAt");
CREATE TABLE "Chat" (
  "id" TEXT PRIMARY KEY, "orderId" BIGINT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Chat_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id")
);
CREATE UNIQUE INDEX "Chat_orderId_key" ON "Chat"("orderId");
CREATE TABLE "ChatMember" (
  "chatId" TEXT NOT NULL, "userId" BIGINT NOT NULL, "lastReadAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatMember_pkey" PRIMARY KEY ("chatId","userId"),
  CONSTRAINT "ChatMember_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE,
  CONSTRAINT "ChatMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE TABLE "Message" (
  "id" BIGSERIAL PRIMARY KEY, "chatId" TEXT NOT NULL, "senderId" BIGINT NOT NULL, "text" VARCHAR(2000) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Message_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE,
  CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id")
);
CREATE INDEX "Message_chatId_createdAt_idx" ON "Message"("chatId","createdAt");
CREATE TABLE "UserBlock" (
  "blockerId" BIGINT NOT NULL, "blockedId" BIGINT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("blockerId","blockedId"),
  CONSTRAINT "UserBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "UserBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE TABLE "Notification" (
  "id" BIGSERIAL PRIMARY KEY, "userId" BIGINT NOT NULL, "type" "NotificationType" NOT NULL,
  "title" VARCHAR(160) NOT NULL, "body" VARCHAR(500) NOT NULL, "data" JSONB, "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId","readAt","createdAt");
CREATE TABLE "Review" (
  "id" BIGSERIAL PRIMARY KEY, "orderId" BIGINT NOT NULL, "authorId" BIGINT NOT NULL, "subjectId" BIGINT NOT NULL,
  "rating" INTEGER NOT NULL CHECK ("rating" BETWEEN 1 AND 5), "text" VARCHAR(1000), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Review_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id"),
  CONSTRAINT "Review_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id"),
  CONSTRAINT "Review_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "User"("id")
);
CREATE UNIQUE INDEX "Review_orderId_authorId_key" ON "Review"("orderId","authorId");
CREATE INDEX "Review_subjectId_createdAt_idx" ON "Review"("subjectId","createdAt");
CREATE TABLE "AuditLog" (
  "id" BIGSERIAL PRIMARY KEY, "actorId" BIGINT, "action" VARCHAR(100) NOT NULL, "entity" VARCHAR(100) NOT NULL,
  "entityId" VARCHAR(100) NOT NULL, "metadata" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id")
);
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity","entityId");
