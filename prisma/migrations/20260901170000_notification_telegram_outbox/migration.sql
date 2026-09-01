-- Durable Telegram outbox on Notification.
-- Existing rows are marked delivered so the worker does not replay history.
ALTER TABLE "Notification" ADD COLUMN "telegramPushedAt" TIMESTAMP(3);

UPDATE "Notification" SET "telegramPushedAt" = "createdAt";

CREATE INDEX "Notification_telegramPushedAt_createdAt_idx"
  ON "Notification"("telegramPushedAt", "createdAt");

CREATE INDEX "Notification_telegram_pending_idx"
  ON "Notification"("createdAt")
  WHERE "telegramPushedAt" IS NULL;
