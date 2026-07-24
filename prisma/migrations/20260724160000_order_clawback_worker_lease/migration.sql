-- CreateEnum
CREATE TYPE "ClawbackStatus" AS ENUM ('OPEN', 'PARTIAL', 'RECOVERED', 'WAIVED');

-- CreateTable
CREATE TABLE "OrderClawback" (
    "id" TEXT NOT NULL,
    "orderId" BIGINT NOT NULL,
    "sellerId" BIGINT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "recoveredCents" BIGINT NOT NULL DEFAULT 0,
    "status" "ClawbackStatus" NOT NULL DEFAULT 'OPEN',
    "reason" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderClawback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerJobLease" (
    "jobName" VARCHAR(64) NOT NULL,
    "holderId" VARCHAR(64) NOT NULL,
    "lockedUntil" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerJobLease_pkey" PRIMARY KEY ("jobName")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderClawback_orderId_key" ON "OrderClawback"("orderId");

-- CreateIndex
CREATE INDEX "OrderClawback_sellerId_status_idx" ON "OrderClawback"("sellerId", "status");

-- CreateIndex
CREATE INDEX "OrderClawback_status_updatedAt_idx" ON "OrderClawback"("status", "updatedAt");

-- AddForeignKey
ALTER TABLE "OrderClawback" ADD CONSTRAINT "OrderClawback_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderClawback" ADD CONSTRAINT "OrderClawback_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
