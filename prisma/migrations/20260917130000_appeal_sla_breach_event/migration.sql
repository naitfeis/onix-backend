-- Workstream F: dedicated SLA breach signal for ban/sell-ban appeals (BAN_APPEAL / SELL_BAN_APPEAL).
-- Kept separate from DISPUTE_SLA_BREACH so paging/analytics can distinguish "we may have
-- wrongly cut off a honest seller" from ordinary order disputes.
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'APPEAL_SLA_BREACH';
