-- HOTFIX 5.5.5: one personal chat per user pair (merge deal + direct duplicates)

-- 1) Order → Chat (many orders share one pair chat)
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "chatId" TEXT;

UPDATE "Order" o
SET "chatId" = c.id
FROM "Chat" c
WHERE c."orderId" = o.id
  AND (o."chatId" IS NULL OR o."chatId" <> c.id);

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

-- 3) Canonical chat per pair: oldest chat wins
CREATE TEMP TABLE canonical_pair_chat AS
SELECT DISTINCT ON (pair_key)
  chat_id AS keep_id,
  pair_key
FROM chat_pair_map
WHERE pair_key IS NOT NULL
ORDER BY pair_key, created_at ASC, chat_id ASC;

-- 4) Move messages into canonical chat
UPDATE "Message" m
SET "chatId" = can.keep_id
FROM chat_pair_map map
INNER JOIN canonical_pair_chat can ON can.pair_key = map.pair_key
WHERE m."chatId" = map.chat_id
  AND map.chat_id <> can.keep_id;

-- 5) Merge members; keep the latest lastReadAt
INSERT INTO "ChatMember" ("chatId", "userId", "lastReadAt", "createdAt")
SELECT can.keep_id, cm."userId", cm."lastReadAt", cm."createdAt"
FROM "ChatMember" cm
INNER JOIN chat_pair_map map ON map.chat_id = cm."chatId"
INNER JOIN canonical_pair_chat can ON can.pair_key = map.pair_key
WHERE map.chat_id <> can.keep_id
ON CONFLICT ("chatId", "userId") DO UPDATE
SET "lastReadAt" = CASE
  WHEN "ChatMember"."lastReadAt" IS NULL THEN EXCLUDED."lastReadAt"
  WHEN EXCLUDED."lastReadAt" IS NULL THEN "ChatMember"."lastReadAt"
  WHEN EXCLUDED."lastReadAt" > "ChatMember"."lastReadAt" THEN EXCLUDED."lastReadAt"
  ELSE "ChatMember"."lastReadAt"
END;

DELETE FROM "ChatMember" cm
USING chat_pair_map map, canonical_pair_chat can
WHERE cm."chatId" = map.chat_id
  AND map.pair_key = can.pair_key
  AND map.chat_id <> can.keep_id;

-- 6) Retarget support tickets and orders
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

-- 7) Drop empty duplicate chats (messages/members already moved)
DELETE FROM "Chat" c
USING chat_pair_map map, canonical_pair_chat can
WHERE c.id = map.chat_id
  AND map.pair_key = can.pair_key
  AND map.chat_id <> can.keep_id;

-- 8) Ensure canonical chats carry stable pairKey
UPDATE "Chat" c
SET "pairKey" = can.pair_key
FROM canonical_pair_chat can
WHERE c.id = can.keep_id
  AND (c."pairKey" IS NULL OR c."pairKey" <> can.pair_key);

-- 9) Drop legacy Chat.orderId (1 chat : 1 order)
ALTER TABLE "Chat" DROP CONSTRAINT IF EXISTS "Chat_orderId_fkey";
DROP INDEX IF EXISTS "Chat_orderId_key";
ALTER TABLE "Chat" DROP COLUMN IF EXISTS "orderId";

-- 10) FK + index for Order.chatId
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

DROP TABLE IF EXISTS canonical_pair_chat;
DROP TABLE IF EXISTS chat_pair_map;
