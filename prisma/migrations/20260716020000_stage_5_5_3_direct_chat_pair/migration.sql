-- HOTFIX 5.5.3: unique Direct Chat pair key (race-safe)
ALTER TABLE "Chat" ADD COLUMN IF NOT EXISTS "pairKey" VARCHAR(64);

-- Deduplicate existing direct chats (orderId IS NULL): keep oldest per unordered member pair.
WITH ranked AS (
  SELECT
    c.id,
    LEAST(m1."userId", m2."userId") AS lo,
    GREATEST(m1."userId", m2."userId") AS hi,
    ROW_NUMBER() OVER (
      PARTITION BY LEAST(m1."userId", m2."userId"), GREATEST(m1."userId", m2."userId")
      ORDER BY c."createdAt" ASC, c.id ASC
    ) AS rn
  FROM "Chat" c
  INNER JOIN "ChatMember" m1 ON m1."chatId" = c.id
  INNER JOIN "ChatMember" m2 ON m2."chatId" = c.id AND m2."userId" > m1."userId"
  WHERE c."orderId" IS NULL
),
dupes AS (
  SELECT id FROM ranked WHERE rn > 1
)
DELETE FROM "Chat" WHERE id IN (SELECT id FROM dupes);

-- Backfill pairKey for remaining direct chats.
UPDATE "Chat" c
SET "pairKey" = (
  SELECT 'd:' || LEAST(m1."userId", m2."userId")::text || ':' || GREATEST(m1."userId", m2."userId")::text
  FROM "ChatMember" m1
  INNER JOIN "ChatMember" m2 ON m2."chatId" = c.id AND m2."userId" > m1."userId"
  WHERE m1."chatId" = c.id
  LIMIT 1
)
WHERE c."orderId" IS NULL AND c."pairKey" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Chat_pairKey_key" ON "Chat"("pairKey");
