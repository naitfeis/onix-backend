-- MANUAL CONTRACT MIGRATION — DO NOT ADD TO prisma/migrations.
--
-- Run in a second release only after every old application/worker instance is
-- gone and the expand migration has been healthy for a full rollout window.
--
-- 1. Take and verify a restorable backup, including these retired tables:
--    pg_dump "$DATABASE_URL" --format=custom \
--      --table='"SellerVerification"' --table='"ProductCreationSession"' \
--      --file=onix-retired-flows-before-contract.dump
-- 2. Record counts immediately before execution:
--    SELECT count(*) FROM "SellerVerification";
--    SELECT count(*) FROM "ProductCreationSession";
-- 3. In the same psql session set the backup acknowledgement and exact counts:
--    SET onix.contract_backup_confirmed = '20260830130000';
--    SET onix.contract_expected_seller_verification_rows = '<count>';
--    SET onix.contract_expected_product_creation_rows = '<count>';
-- 4. Execute this file. Any count drift aborts before destructive statements.

DO $contract$
DECLARE
  seller_rows bigint := 0;
  product_rows bigint := 0;
  expected_seller_rows bigint;
  expected_product_rows bigint;
BEGIN
  IF current_setting('onix.contract_backup_confirmed', true) IS DISTINCT FROM '20260830130000' THEN
    RAISE EXCEPTION 'Verified backup acknowledgement is required';
  END IF;
  IF current_setting('onix.contract_expected_seller_verification_rows', true) IS NULL
    OR current_setting('onix.contract_expected_product_creation_rows', true) IS NULL THEN
    RAISE EXCEPTION 'Both pre-contract row counts are required';
  END IF;

  expected_seller_rows :=
    current_setting('onix.contract_expected_seller_verification_rows', true)::bigint;
  expected_product_rows :=
    current_setting('onix.contract_expected_product_creation_rows', true)::bigint;

  IF to_regclass('"SellerVerification"') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM "SellerVerification"' INTO seller_rows;
  END IF;
  IF to_regclass('"ProductCreationSession"') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM "ProductCreationSession"' INTO product_rows;
  END IF;

  IF seller_rows <> expected_seller_rows OR product_rows <> expected_product_rows THEN
    RAISE EXCEPTION
      'Retired-flow row counts changed (seller %, expected %; product %, expected %)',
      seller_rows, expected_seller_rows, product_rows, expected_product_rows;
  END IF;
END
$contract$;

DROP TABLE IF EXISTS "SellerVerification";
DROP TYPE IF EXISTS "SellerVerificationKind";
DROP TYPE IF EXISTS "SellerVerificationStatus";

DROP TABLE IF EXISTS "ProductCreationSession";
DROP TYPE IF EXISTS "ProductCreationStatus";
