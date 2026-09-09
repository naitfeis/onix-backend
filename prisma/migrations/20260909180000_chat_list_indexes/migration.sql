-- Chat list search by peer displayName; membership lookup already has (userId).
CREATE INDEX IF NOT EXISTS "User_displayName_idx" ON "User"("displayName");

-- Support membership scans when joining Chat ordered by updatedAt.
CREATE INDEX IF NOT EXISTS "ChatMember_userId_createdAt_idx" ON "ChatMember"("userId", "createdAt");
