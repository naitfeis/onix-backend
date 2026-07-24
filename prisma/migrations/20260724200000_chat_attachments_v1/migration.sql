-- Chat Attachments v1: Message contentType + ChatAttachment metadata (bytes in R2).

CREATE TYPE "MessageContentType" AS ENUM ('TEXT', 'IMAGE', 'FILE');
CREATE TYPE "AttachmentStatus" AS ENUM ('PENDING', 'READY', 'REJECTED', 'DELETED');

ALTER TABLE "Message"
  ADD COLUMN "contentType" "MessageContentType" NOT NULL DEFAULT 'TEXT',
  ADD COLUMN "metadata" JSONB;

CREATE TABLE "ChatAttachment" (
  "id" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "ownerId" BIGINT NOT NULL,
  "messageId" BIGINT,
  "originalName" VARCHAR(255) NOT NULL,
  "mimeType" VARCHAR(100) NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "storageKey" VARCHAR(512) NOT NULL,
  "sha256" VARCHAR(64),
  "status" "AttachmentStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChatAttachment_messageId_key" ON "ChatAttachment"("messageId");
CREATE UNIQUE INDEX "ChatAttachment_storageKey_key" ON "ChatAttachment"("storageKey");
CREATE INDEX "ChatAttachment_chatId_status_createdAt_idx" ON "ChatAttachment"("chatId", "status", "createdAt");
CREATE INDEX "ChatAttachment_status_createdAt_idx" ON "ChatAttachment"("status", "createdAt");
CREATE INDEX "ChatAttachment_ownerId_createdAt_idx" ON "ChatAttachment"("ownerId", "createdAt");

ALTER TABLE "ChatAttachment"
  ADD CONSTRAINT "ChatAttachment_chatId_fkey"
  FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatAttachment"
  ADD CONSTRAINT "ChatAttachment_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatAttachment"
  ADD CONSTRAINT "ChatAttachment_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
