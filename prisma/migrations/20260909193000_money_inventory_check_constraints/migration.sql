-- Money / inventory invariants at DB layer.
-- CHECK ... NOT VALID: enforce on NEW writes immediately; do not fail deploy on legacy rows.
-- Validate later with: ALTER TABLE ... VALIDATE CONSTRAINT ...

ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "user_balance_nonneg";
ALTER TABLE "User"
  ADD CONSTRAINT "user_balance_nonneg" CHECK ("balanceCents" >= 0) NOT VALID;

ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "user_deposit_avail_nonneg";
ALTER TABLE "User"
  ADD CONSTRAINT "user_deposit_avail_nonneg" CHECK ("depositAvailableCents" >= 0) NOT VALID;

ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "user_deposit_locked_nonneg";
ALTER TABLE "User"
  ADD CONSTRAINT "user_deposit_locked_nonneg" CHECK ("depositLockedCents" >= 0) NOT VALID;

ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "order_amounts_nonneg";
ALTER TABLE "Order"
  ADD CONSTRAINT "order_amounts_nonneg"
  CHECK ("totalAmountCents" >= 0 AND "feeCents" >= 0 AND "payoutCents" >= 0) NOT VALID;

ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "order_payout_lte_total";
ALTER TABLE "Order"
  ADD CONSTRAINT "order_payout_lte_total" CHECK ("payoutCents" <= "totalAmountCents") NOT VALID;

ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "order_fee_payout_sum";
ALTER TABLE "Order"
  ADD CONSTRAINT "order_fee_payout_sum"
  CHECK ("feeCents" + "payoutCents" = "totalAmountCents") NOT VALID;

ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "order_quantity_positive";
ALTER TABLE "Order"
  ADD CONSTRAINT "order_quantity_positive" CHECK ("quantity" >= 1) NOT VALID;

ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "product_quantity_nonneg";
ALTER TABLE "Product"
  ADD CONSTRAINT "product_quantity_nonneg" CHECK ("quantity" >= 0) NOT VALID;

ALTER TABLE "PaymentIntent" DROP CONSTRAINT IF EXISTS "payment_intent_amount_positive";
ALTER TABLE "PaymentIntent"
  ADD CONSTRAINT "payment_intent_amount_positive" CHECK ("amountCents" > 0) NOT VALID;

-- Unique SALE_PAYOUT per order — only if no legacy duplicates.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "LedgerEntry"
    WHERE "type" = 'SALE_PAYOUT' AND "orderId" IS NOT NULL
    GROUP BY "orderId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE NOTICE 'skip ledger_one_sale_payout_per_order: duplicate SALE_PAYOUT rows exist';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "ledger_one_sale_payout_per_order"
      ON "LedgerEntry" ("orderId")
      WHERE "type" = 'SALE_PAYOUT' AND "orderId" IS NOT NULL;
  END IF;
END $$;
