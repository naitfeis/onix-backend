-- Parked chat attachments left objects on Neon after migration folder was removed.
-- Align DB with current schema.prisma (no ChatAttachment / Message.contentType).

DROP TABLE IF EXISTS "ChatAttachment";

ALTER TABLE "Message" DROP COLUMN IF EXISTS "contentType";
ALTER TABLE "Message" DROP COLUMN IF EXISTS "metadata";

DROP TYPE IF EXISTS "AttachmentStatus";
DROP TYPE IF EXISTS "MessageContentType";
