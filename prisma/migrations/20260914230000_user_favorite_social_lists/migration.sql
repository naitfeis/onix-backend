-- User-to-user favorites (separate from product Favorite)
CREATE TABLE "UserFavorite" (
    "userId" BIGINT NOT NULL,
    "targetId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserFavorite_pkey" PRIMARY KEY ("userId","targetId")
);

CREATE INDEX "UserFavorite_targetId_idx" ON "UserFavorite"("targetId");

ALTER TABLE "UserFavorite" ADD CONSTRAINT "UserFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserFavorite" ADD CONSTRAINT "UserFavorite_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "UserBlock_blockerId_createdAt_idx" ON "UserBlock"("blockerId", "createdAt");
CREATE INDEX "UserBlock_blockedId_idx" ON "UserBlock"("blockedId");
