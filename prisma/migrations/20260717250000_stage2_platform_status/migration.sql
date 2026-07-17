-- CreateEnum
CREATE TYPE "PlatformStatus" AS ENUM ('USER', 'VERIFIED_SELLER', 'MODERATOR', 'ADMIN', 'VIP');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "platformStatus" "PlatformStatus" NOT NULL DEFAULT 'USER';

-- Backfill from legacy staff flags
UPDATE "User" SET "platformStatus" = 'ADMIN' WHERE "isAdmin" = true;
UPDATE "User" SET "platformStatus" = 'MODERATOR' WHERE "isSupport" = true AND "isAdmin" = false;

-- Index for admin filters
CREATE INDEX "User_platformStatus_idx" ON "User"("platformStatus");
