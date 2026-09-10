-- Clawback collector: security signal when SALE_PROCEEDS already withdrawn.
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'CLAWBACK_DEBT';
