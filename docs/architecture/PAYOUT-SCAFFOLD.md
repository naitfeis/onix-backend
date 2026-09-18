# Payout scaffold (workstream A)

`wallet.withdraw` still applies all existing MFA, risk-engine, velocity, clawback,
spendable-balance, and account-lock guards. Its serializable transaction now creates
one `PayoutRequest` for the unique `WITHDRAWAL` ledger row. A request stores amount,
status, review reasons, and an optional one-way destination fingerprint; raw payout
destination details are not stored.

## Safe operating model

- `PAYOUTS_AUTO_ENABLED=false` by default.
- The only provider is `MANUAL`, which is not external-transfer capable and never
  reports a transfer or marks a request `PAID`.
- If automation is enabled with only `MANUAL`, the worker creates one idempotent
  attempt and moves the request to `MANUAL_REVIEW`.
- `PROCESSING` is not payment confirmation. The worker leaves submitted requests
  there until future authenticated provider reconciliation exists and alerts when
  they are stale.
- Finance or super admins may approve or reject. Rejecting a debited request creates
  one `WITHDRAWAL_REVERSAL` ledger credit and records its unique key and admin audit
  log in the same serializable transaction.
- A `PROCESSING` or `PAID` request cannot be rejected because provider outcome may be
  uncertain. Operations must reconcile it first.

Review thresholds are configured by the `PAYOUT_*` variables documented in
`.env.example`. They route requests to review and do not bypass any withdrawal guard.
