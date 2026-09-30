-- Realtime audit: chat messages had no idempotency key, so a client network retry
-- (connection reset / 502-504 are retried up to 3x) could insert the same message twice.
-- A unique index makes one logical send insert at most one row, atomically and crash-safely.
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "clientMessageId" VARCHAR(64);

-- Scoped per chat: only members can send there, so a squatted id cannot block
-- another conversation. NULLs are distinct in Postgres, so system and legacy
-- messages (clientMessageId IS NULL) remain unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS "Message_chatId_clientMessageId_key" ON "Message"("chatId", "clientMessageId");

-- History is keyset-paginated by id (WHERE chatId AND id < cursor ORDER BY id DESC),
-- so it needs an index that matches both predicates.
CREATE INDEX IF NOT EXISTS "Message_chatId_id_idx" ON "Message"("chatId", "id");
