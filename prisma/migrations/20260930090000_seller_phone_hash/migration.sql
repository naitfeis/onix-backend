-- Seller phone capture for anti-fraud: store only an HMAC-SHA256 of the E.164 number
-- keyed by PHONE_HASH_SECRET. A keyed hash is required because an unkeyed one is
-- brute-forceable offline -- the phone number space is small and public.
-- UNIQUE so one phone cannot back two accounts; the raw number is never persisted.
ALTER TABLE "User" ADD COLUMN "phoneHash" VARCHAR(64);
ALTER TABLE "User" ADD COLUMN "phoneSharedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_phoneHash_key" ON "User"("phoneHash");