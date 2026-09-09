-- Money / inventory invariants enforced at the database layer (not only app code).
-- Safe on empty or consistent production data; NOT VALID skipped — use concurrent-safe adds.

-- Wallet non-negative (BalanceService already enforces; DB is belt-and-suspenders).
ALTER TABLE "User"
  DROP CONSTRAINT IF EXISTS "user_balance_nonneg";
ALTER TABLE "User"
  ADD CONSTRAINT "user_balance_nonneg" CHECK ("balanceCents" >= 0);

ALTER TABLE "User"
  DROP CONSTRAINT IF EXISTS "user_deposit_avail_nonneg";
ALTER TABLE "User"
  ADD CONSTRAINT "user_deposit_avail_nonneg" CHECK ("depositAvailableCents" >= 0);

ALTER TABLE "User"
  DROP CONSTRAINT IF EXISTS "user_deposit_locked_nonneg";
ALTER TABLE "User"
  ADD CONSTRAINT "user_deposit_locked_nonneg" CHECK ("depositLockedCents" >= 0);

-- Order money split: fee + payout = total; no negative legs; payout ≤ total.
ALTER TABLE "Order"
  DROP CONSTRAINT IF EXISTS "order_amounts_nonneg";
ALTER TABLE "Order"
  ADD CONSTRAINT "order_amounts_nonneg"
  CHECK ("totalAmountCents" >= 0 AND "feeCents" >= 0 AND "payoutCents" >= 0);

ALTER TABLE "Order"
  DROP CONSTRAINT IF EXISTS "order_payout_lte_total";
ALTER TABLE "Order"
  ADD CONSTRAINT "order_payout_lte_total" CHECK ("payoutCents" <= "totalAmountCents");

ALTER TABLE "Order"
  DROP CONSTRAINT IF EXISTS "order_fee_payout_sum";
ALTER TABLE "Order"
  ADD CONSTRAINT "order_fee_payout_sum"
  CHECK ("feeCents" + "payoutCents" = "totalAmountCents");

ALTER TABLE "Order"
  DROP CONSTRAINT IF EXISTS "order_quantity_positive";
ALTER TABLE "Order"
  ADD CONSTRAINT "order_quantity_positive" CHECK ("quantity" >= 1);

-- Product stock cannot go negative.
ALTER TABLE "Product"
  DROP CONSTRAINT IF EXISTS "product_quantity_nonneg";
ALTER TABLE "Product"
  ADD CONSTRAINT "product_quantity_nonneg" CHECK ("quantity" >= 0);

-- PaymentIntent amounts must be positive.
ALTER TABLE "PaymentIntent"
  DROP CONSTRAINT IF EXISTS "payment_intent_amount_positive";
ALTER TABLE "PaymentIntent"
  ADD CONSTRAINT "payment_intent_amount_positive" CHECK ("amountCents" > 0);

-- At most one SALE_PAYOUT ledger row per order (idempotency key is also unique).
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_one_sale_payout_per_order"
  ON "LedgerEntry" ("orderId")
  WHERE "type" = 'SALE_PAYOUT' AND "orderId" IS NOT NULL;
