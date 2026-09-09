# Amvera ship note — v2.0.3

Deploy branch for Moscow: **`v2.0.3-amvera`** (or point Amvera Git to `v2.0.3`).

Includes money/security hardening from the v2.0.3 line:
- order state machine + admin complete from PAYMENT_HOLD
- escrow clawback ≤ payout; money CHECK migration
- withdrawal concurrency locks
- payment expire skips intents with `providerRef`
- rate limits on purchase/support

Runtime still runs `prisma migrate deploy` via `scripts/start-amvera.mjs`.
