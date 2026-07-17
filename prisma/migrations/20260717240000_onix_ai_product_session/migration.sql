-- ONIX AI system chat + product creation sessions + public lot numbers

ALTER TYPE "ChatKind" ADD VALUE IF NOT EXISTS 'AI';

CREATE TYPE "ProductCreationStatus" AS ENUM (
  'WAIT_TITLE',
  'WAIT_CATEGORY',
  'WAIT_SUBCATEGORY',
  'WAIT_PRICE',
  'WAIT_QUANTITY',
  'WAIT_DESCRIPTION',
  'READY',
  'FINISHED'
);

CREATE SEQUENCE IF NOT EXISTS "Product_lotNumber_seq";

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "lotNumber" INTEGER;

UPDATE "Product"
SET "lotNumber" = nextval('"Product_lotNumber_seq"')
WHERE "lotNumber" IS NULL;

ALTER TABLE "Product" ALTER COLUMN "lotNumber" SET NOT NULL;
ALTER TABLE "Product" ALTER COLUMN "lotNumber" SET DEFAULT nextval('"Product_lotNumber_seq"');
ALTER SEQUENCE "Product_lotNumber_seq" OWNED BY "Product"."lotNumber";

CREATE UNIQUE INDEX IF NOT EXISTS "Product_lotNumber_key" ON "Product"("lotNumber");

CREATE TABLE IF NOT EXISTS "ProductCreationSession" (
  "id" TEXT NOT NULL,
  "userId" BIGINT NOT NULL,
  "chatId" TEXT NOT NULL,
  "title" VARCHAR(32),
  "category" "ProductCategory",
  "subcategory" "ProductSubcategory",
  "priceCents" BIGINT,
  "quantity" INTEGER,
  "description" TEXT,
  "images" JSONB,
  "status" "ProductCreationStatus" NOT NULL DEFAULT 'WAIT_TITLE',
  "productId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductCreationSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProductCreationSession_userId_status_idx"
  ON "ProductCreationSession"("userId", "status");
CREATE INDEX IF NOT EXISTS "ProductCreationSession_chatId_status_idx"
  ON "ProductCreationSession"("chatId", "status");

DO $$ BEGIN
  ALTER TABLE "ProductCreationSession"
    ADD CONSTRAINT "ProductCreationSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ProductCreationSession"
    ADD CONSTRAINT "ProductCreationSession_chatId_fkey"
    FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
