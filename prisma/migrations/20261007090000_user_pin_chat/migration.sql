-- Replace chat person favorites with pinned chats.
CREATE TABLE "UserPin" (
    "userId" BIGINT NOT NULL,
    "targetId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPin_pkey" PRIMARY KEY ("userId","targetId")
);

CREATE INDEX "UserPin_targetId_idx" ON "UserPin"("targetId");

ALTER TABLE "UserPin" ADD CONSTRAINT "UserPin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserPin" ADD CONSTRAINT "UserPin_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve existing chat pins for users who already used chat favorites.
INSERT INTO "UserPin" ("userId", "targetId", "createdAt")
SELECT "userId", "targetId", "createdAt"
FROM "UserFavorite"
ON CONFLICT DO NOTHING;

DROP TABLE "UserFavorite";
