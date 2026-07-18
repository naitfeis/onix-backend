-- Worker job run journal (ops / drills / alerting).
-- IdempotencyRecord already exists from auth_phase1 (key+route).

CREATE TABLE "WorkerJobRun" (
    "id" TEXT NOT NULL,
    "jobName" VARCHAR(64) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "error" VARCHAR(1000),
    "metadata" JSONB,

    CONSTRAINT "WorkerJobRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkerJobRun_jobName_startedAt_idx" ON "WorkerJobRun"("jobName", "startedAt");
