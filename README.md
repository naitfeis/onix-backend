# ONIX Backend

NestJS API for the ONIX marketplace. PostgreSQL is accessed only through Prisma; money is stored as `BigInt` kopecks and serialized as decimal strings.

## Configuration

Required environment variables:

- `DATABASE_URL` — PostgreSQL connection string
- `BOT_TOKEN` — Telegram bot token used to verify Mini App and Login Widget signatures
- `JWT_SECRET` — random secret of at least 32 characters
- `ADMIN_TELEGRAM_ID` — Telegram ID granted admin role when the profile is first created
- `CORS_ORIGINS` — comma-separated trusted website/Mini App origins
- `TELEGRAM_AUTH_MAX_AGE_SECONDS` — signature age limit (default `3600`)
- `JWT_TTL_DAYS` — session lifetime (default `7`)
- `DEPOSIT_HOLD_DAYS` — post-sale deposit freeze (default `10`)
- `MANUAL_PAYMENTS_ENABLED` — allow non-admin Manual payment confirm (`true`/`1`)

## Authentication

Both login methods resolve the same `User` by verified Telegram ID:

- `POST /api/auth/telegram-mini` with `{ "initData": "..." }`
- `POST /api/auth/telegram-login` with the exact Telegram Login Widget payload

They return a signed Bearer token. All other API routes except `/api/health/live` require `Authorization: Bearer <token>`. User identity is never accepted from body or query parameters.

## API

- Profiles/wallet: `GET|PATCH /api/users/me`, `GET /api/users/:onixId`, `GET /api/wallet/ledger`, `POST /api/wallet/withdrawals`
- Deposit wallet: `GET /api/wallet/deposit`, `/ledger`, `/locks`, `POST /api/wallet/deposit/withdrawals`
- Payments: `POST /api/payments/intents`, `POST /api/payments/intents/:id/confirm`, `GET /api/payments/intents/:id`
- Trust: `GET /api/users/me/trust`, `/history`, `POST /api/users/me/trust/recompute`, `GET /api/users/:onixId/trust-card`
- Verification: `GET /api/users/me/verifications`, `POST .../verifications/:kind/start|confirm`
- ONIX PRO: `GET /api/users/me/pro`, admin `POST /api/admin/users/:onixId/pro/grant|revoke`
- Analytics foundation: `POST /api/products/:id/views`
- Marketplace: `GET|POST /api/products`, `GET|PATCH|DELETE /api/products/:id`, `POST /api/products/:id/publish`
- Social: `/api/favorites/:productId`, `/api/users/:onixId/follow`, `/api/users/:onixId/block`
- Escrow: `POST /api/orders/product/:productId`, then `/:id/deliver`, `/:id/complete`, `/:id/cancel`, `/:id/dispute`; `GET /api/orders`
- Chat: `GET /api/chats`, `POST /api/chats/direct`, `GET|POST /api/chats/:id/messages`
- Notifications/reviews: `/api/notifications`, `/api/notifications/:id/read`, `/api/users/:onixId/reviews`, `/api/orders/:id/reviews`
- Admin: balance adjustment, user ban/unban, and escrow refund under `/api/admin`
- Health: `GET /api/health/live`, `GET /api/health/ready`

See also: [docs/architecture/ONIX-TRUST-STAGE1-FOUNDATION.md](docs/architecture/ONIX-TRUST-STAGE1-FOUNDATION.md)

All responses use `{ "success": true, "data": ... }` or `{ "success": false, "error": { "code", "message" } }`.

## Ops / production readiness

| Concern | How |
| --- | --- |
| Structured logs | JSON to stdout (`LOG_LEVEL`, secrets redacted) |
| Metrics | `GET /api/metrics` (Prometheus), `GET /api/metrics/json` |
| Error tracking | `ERROR_WEBHOOK_URL` / optional `SENTRY_DSN` |
| Alerting | in-process rules → `ALERT_WEBHOOK_URL` (see `ops/alerting-rules.json`) |
| Workers | `npm run start:worker` (Render worker `onix-worker`) |
| Graceful shutdown | SIGTERM/SIGINT drain (`SHUTDOWN_TIMEOUT_MS`) |
| Idempotency | ledger keys + `IdempotencyRecord` for external ops |
| Monetary tests | `npm run test:monetary` |
| Load test | `npm run test:load` (`LOAD_BASE_URL`, …) |
| Backup drill | `npm run ops:backup-drill -- check\|backup\|restore-dry-run` |

Optional env: `OPS_METRICS_TOKEN`, `ALERTING_ENABLED`, `ALERT_RULES_JSON`.

## Development

```bash
npm run prisma:format
npm run prisma:validate
npm run prisma:generate
npm run typecheck
npm test
npm run test:monetary
npm run build
npm run start:dev
npm run start:dev:worker
```

The SQL migration is provided in `prisma/migrations/20260712140000_onix_backend/migration.sql` but must be reviewed and applied separately. It deliberately stops if legacy users lack a Telegram identity; no production database migration is run automatically.

If the baseline SQL was applied manually, verify that every statement completed before registering it and deploying later migrations:

```bash
npx prisma migrate resolve --applied 20260712140000_onix_backend
npx prisma migrate deploy
```

Run both commands with the same `DATABASE_URL` used by the Render service. Never mark a partially applied baseline migration as complete.
