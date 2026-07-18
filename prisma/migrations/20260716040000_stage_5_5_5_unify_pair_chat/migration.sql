-- HOTFIX 5.5.5 / 5.5.5.2: one personal chat per user pair (merge deal + direct duplicates)
-- Avoid INSERT ... ON CONFLICT DO UPDATE (SQLSTATE 21000 when SELECT emits duplicate keys).

DROP TABLE IF EXISTS canonical_pair_chat;
DROP TABLE IF EXISTS chat_pair_map;
DROP TABLE IF EXISTS merge_members;

-- 1) Order → Chat (many orders share one pair chat). Idempotent if Chat.orderId already dropped.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "chatId" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Chat'
      AND column_name = 'orderId'
  ) THEN
    UPDATE "Order" o
    SET "chatId" = c.id
    FROM "Chat" c
    WHERE c."orderId" = o.id
      AND (o."chatId" IS NULL OR o."chatId" <> c.id);
  END IF;
END $$;

-- 2) Resolve pairKey for every chat (order buyer/seller, else two non-staff members, else any two members)
CREATE TEMP TABLE chat_pair_map AS
SELECT
  c.id AS chat_id,
  c."createdAt" AS created_at,
  COALESCE(
    c."pairKey",
    (
      SELECT 'd:' || LEAST(o."buyerId", o."sellerId")::text || ':' || GREATEST(o."buyerId", o."sellerId")::text
      FROM "Order" o
      WHERE o."chatId" = c.id
      ORDER BY o."createdAt" ASC, o.id ASC
      LIMIT 1
    ),
    (
      SELECT 'd:' || LEAST(m1."userId", m2."userId")::text || ':' || GREATEST(m1."userId", m2."userId")::text
      FROM "ChatMember" m1
      INNER JOIN "ChatMember" m2 ON m2."chatId" = c.id AND m2."userId" > m1."userId"
      INNER JOIN "User" u1 ON u1.id = m1."userId"
      INNER JOIN "User" u2 ON u2.id = m2."userId"
      WHERE m1."chatId" = c.id
        AND COALESCE(u1."isAdmin", false) = false
        AND COALESCE(u1."isSupport", false) = false
        AND COALESCE(u2."isAdmin", false) = false
        AND COALESCE(u2."isSupport", false) = false
      ORDER BY m1."userId", m2."userId"
      LIMIT 1
    ),
    (
      SELECT 'd:' || LEAST(m1."userId", m2."userId")::text || ':' || GREATEST(m1."userId", m2."userId")::text
      FROM "ChatMember" m1
      INNER JOIN "ChatMember" m2 ON m2."chatId" = c.id AND m2."userId" > m1."userId"
      WHERE m1."chatId" = c.id
      ORDER BY m1."userId", m2."userId"
      LIMIT 1
    )
  ) AS pair_key
FROM "Chat" c;

-- 3) Canonical chat per pair: oldest chat wins (exactly one keep_id per pair_key)
CREATE TEMP TABLE canonical_pair_chat AS
SELECT DISTINCT ON (pair_key)
  chat_id AS keep_id,
  pair_key
FROM chat_pair_map
WHERE pair_key IS NOT NULL
ORDER BY pair_key, created_at ASC, chat_id ASC;

-- 4) Move messages into canonical chat (no deletes — only retarget chatId)
UPDATE "Message" m
SET "chatId" = can.keep_id
FROM chat_pair_map map
INNER JOIN canonical_pair_chat can ON can.pair_key = map.pair_key
WHERE m."chatId" = map.chat_id
  AND map.chat_id <> can.keep_id;

-- 5) Merge members without ON CONFLICT DO UPDATE.
-- Aggregate first so each (keep_id, userId) appears once, then UPDATE existing + INSERT missing.
CREATE TEMP TABLE merge_members AS
SELECT
  can.keep_id AS chat_id,
  cm."userId" AS user_id,
  MAX(cm."lastReadAt") AS last_read_at,
  MIN(cm."createdAt") AS created_at
FROM "ChatMember" cm
INNER JOIN chat_pair_map map ON map.chat_id = cm."chatId"
INNER JOIN canonical_pair_chat can ON can.pair_key = map.pair_key
WHERE map.chat_id <> can.keep_id
GROUP BY can.keep_id, cm."userId";

UPDATE "ChatMember" tgt
SET "lastReadAt" = CASE
  WHEN tgt."lastReadAt" IS NULL THEN src.last_read_at
  WHEN src.last_read_at IS NULL THEN tgt."lastReadAt"
  WHEN src.last_read_at > tgt."lastReadAt" THEN src.last_read_at
  ELSE tgt."lastReadAt"
END
FROM merge_members src
WHERE tgt."chatId" = src.chat_id
  AND tgt."userId" = src.user_id;

INSERT INTO "ChatMember" ("chatId", "userId", "lastReadAt", "createdAt")
SELECT
  src.chat_id,
  src.user_id,
  src.last_read_at,
  src.created_at
FROM merge_members src
WHERE NOT EXISTS (
  SELECT 1
  FROM "ChatMember" x
  WHERE x."chatId" = src.chat_id
    AND x."userId" = src.user_id
);

-- Remove membership rows from non-canonical chats (data already merged above)
DELETE FROM "ChatMember" cm
USING chat_pair_map map, canonical_pair_chat can
WHERE cm."chatId" = map.chat_id
  AND map.pair_key = can.pair_key
  AND map.chat_id <> can.keep_id;

-- 6) Retarget support tickets and orders (preserve all links)
UPDATE "SupportTicket" st
SET "chatId" = can.keep_id
FROM chat_pair_map map
INNER JOIN canonical_pair_chat can ON can.pair_key = map.pair_key
WHERE st."chatId" = map.chat_id
  AND map.chat_id <> can.keep_id;

UPDATE "Order" o
SET "chatId" = can.keep_id
FROM chat_pair_map map
INNER JOIN canonical_pair_chat can ON can.pair_key = map.pair_key
WHERE o."chatId" = map.chat_id
  AND map.chat_id <> can.keep_id;

-- 7) Drop empty duplicate chats only (messages/members/tickets/orders already retargeted)
DELETE FROM "Chat" c
USING chat_pair_map map, canonical_pair_chat can
WHERE c.id = map.chat_id
  AND map.pair_key = can.pair_key
  AND map.chat_id <> can.keep_id;

-- 8) Ensure canonical chats carry stable pairKey (one UPDATE target per pair_key)
UPDATE "Chat" c
SET "pairKey" = can.pair_key
FROM canonical_pair_chat can
WHERE c.id = can.keep_id
  AND (c."pairKey" IS NULL OR c."pairKey" <> can.pair_key);

-- 9) Drop legacy Chat.orderId (1 chat : 1 order) — idempotent
ALTER TABLE "Chat" DROP CONSTRAINT IF EXISTS "Chat_orderId_fkey";
DROP INDEX IF EXISTS "Chat_orderId_key";
ALTER TABLE "Chat" DROP COLUMN IF EXISTS "orderId";

-- 10) FK + index for Order.chatId — idempotent
CREATE INDEX IF NOT EXISTS "Order_chatId_idx" ON "Order"("chatId");

DO $$ BEGIN
  ALTER TABLE "Order"
    ADD CONSTRAINT "Order_chatId_fkey"
    FOREIGN KEY ("chatId") REFERENCES "Chat"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Chat_pairKey_key" ON "Chat"("pairKey");

DROP TABLE IF EXISTS merge_members;
DROP TABLE IF EXISTS canonical_pair_chat;
DROP TABLE IF EXISTS chat_pair_map;
