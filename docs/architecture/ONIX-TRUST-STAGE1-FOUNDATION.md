# ONIX Trust & Seller Economy — Stage 1 Foundation

Статус: **foundation implemented** — полный UI / Stage 2 analytics UI **не** в scope.  
Ворота: полный аудит Stage 1 обязателен до Stage 2.

## Цель

Production-ready фундамент:

- PaymentProvider (сейчас Manual)
- Два кошелька: основной + залог
- Заморозка залога после сделки (lazy unlock)
- Trust Score (internal) → Trust Level (public)
- TrustHistory, Verification, ONIX PRO (отдельно от trust)
- Analytics schema + unique view recorder
- Public Trust Card **API** (без финального UI)

## Миграция

`prisma/migrations/20260717180000_stage1_trust_economy_foundation/migration.sql`

Additive columns on `User`:

- `depositAvailableCents`, `depositLockedCents`
- `trustScore`, `trustLevel`, `trustScoreVersion`, `trustComputedAt`, `trustDirty`

Новые таблицы:

| Table | Role |
| --- | --- |
| `PaymentIntent` | Provider-agnostic top-up |
| `DepositLedgerEntry` | Deposit money journal |
| `DepositLock` | Per-order freeze |
| `TrustHistoryEvent` | Trust audit journal |
| `SellerVerification` | PHONE_* / PASSPORT / VOICE_IDENTITY |
| `SellerSubscription` | ONIX PRO (not trust) |
| `ProductViewUnique` | Unique views foundation |
| `SellerAnalyticsDaily` | Rollup schema for Stage 2 |

## Модуль

`safe-deal-platform/src/economy/`

| Service | Responsibility |
| --- | --- |
| `PaymentsService` + `ManualPaymentProvider` | Intents → credit MAIN/DEPOSIT |
| `BalanceService` | **Only** path for `balanceCents` |
| `DepositService` | **Only** path for deposit available/locked |
| `LockService` | Freeze on COMPLETED; HELD_DISPUTE; lazy unlock |
| `TrustService` | Score 0–1000 → Level 1–5; history |
| `VerificationService` | Status + hash only (no media) |
| `ProSubscriptionService` | PRO grant/revoke (no score mutation) |
| `AnalyticsFoundationService` | Unique view write path |
| `WalletEconomyService` | Owner/public trust + deposit APIs |

Wired into:

- `AppModule` → `EconomyModule`
- `EscrowModule` → uses `BalanceService` + `LockService`
- `OperationsModule` → withdraw/adjust via `BalanceService`

## Платежи

```
PaymentProvider
  ManualPaymentProvider     // implemented
  (YOOKASSA / TELEGRAM_WALLET / CRYPTO / CARD / STRIPE) // rejected until wired
```

Env:

- `MANUAL_PAYMENTS_ENABLED=true` — self-serve Manual top-up in non-admin contexts
- Without flag: Manual create/confirm только для `isAdmin`

API:

- `POST /api/payments/intents` `{ wallet: MAIN|DEPOSIT, amountCents, provider, idempotencyKey }`
- `POST /api/payments/intents/:id/confirm` (Manual)
- `GET /api/payments/intents/:id`

## Залог

Публично: `depositAvailable + depositLocked` (total only).  
Продавцу: available / locked / total.

После `Order COMPLETED`:

1. SALE_PAYOUT через `BalanceService`
2. `LockService.lockOnSaleComplete` — `min(dealAmount, available)` на `DEPOSIT_HOLD_DAYS` (default **10**)

Unlock: **lazy** при `GET /wallet/deposit`, locks list, deposit withdraw — без cron (в проекте нет scheduler; соответствует текущей инфраструктуре).

Dispute → `HELD_DISPUTE` (cron/lazy не снимает).

API:

- `GET /api/wallet/deposit`
- `GET /api/wallet/deposit/ledger`
- `GET /api/wallet/deposit/locks`
- `POST /api/wallet/deposit/withdrawals`

## Trust

Internal `trustScore` 0–1000; public `trustLevel` 1–5:

| Score | Level |
| --- | --- |
| 0–149 | I |
| 150–349 | II |
| 350–549 | III |
| 550–749 | IV |
| 750–1000 | V |

API:

- `GET /api/users/me/trust` — score + card + history (owner)
- `GET /api/users/me/trust/history`
- `POST /api/users/me/trust/recompute`
- `GET /api/users/:onixId/trust-card` — **public card, no score**

## Verification

Kinds: `PHONE_SMS` | `PHONE_CALL` | `PHONE_VOICE` | `PASSPORT` | `VOICE_IDENTITY`

Хранение: `status`, `verifiedAt`, `evidenceHash`, `providerRef`. **Без аудио/сканов.**

## ONIX PRO

`SellerSubscription` — коммерция. `PRO_GRANTED` / `PRO_ENDED` в TrustHistory для прозрачности, **не** входит в формулу score.

- `GET /api/users/me/pro`
- `POST /api/admin/users/:onixId/pro/grant`
- `POST /api/admin/users/:onixId/pro/revoke`

## Analytics foundation

- Schema: `ProductViewUnique`, `SellerAnalyticsDaily`
- `POST /api/products/:id/views` — unique; ignores owner / bot UA / prefetch

## Обратная совместимость

- Старые поля `balanceCents` / ledger types сохранены
- FE contracts: additive `API_PATHS` + types `DepositWallet` / `TrustCard`
- Public seller DTO в каталоге **не** ломался (trust-card — отдельный endpoint)

## Stage 1 UI wiring (audit follow-up)

Owner profile — **один RTT**:

`GET /api/users/me` → `balanceCents` + `deposit{available,locked,total}` + `trustCard` (без `trustScore`).

Внутри `getMe` перед ответом вызывается `LockService.releaseExpiredForUser` (lazy unlock).

Публичный профиль:

`GET /api/users/:onixId/trust-card` — только public card (`level`, `depositTotal`, `phoneVerified`, …). **Нет `trustScore`.**

Отдельные `GET /wallet/deposit` и `GET /users/me/trust` остаются для детальных экранов; Profile их больше не дергает при открытии.

Примечание: `GET /api/wallet/locks` **не существует**; locks — `GET /api/wallet/deposit/locks`.

## Риски / проверка на аудите

1. Lazy unlock vs «автоматически» — корректно при любом обращении к депозиту; при отсутствии обращений locked остаётся до первого access (приемлемо без cron).
2. Escrow money path полностью через `BalanceService` — регрессия purchase/complete/refund.
3. Manual payments в prod только admin / flag.
4. `trustScore` не должен попасть в public product/seller list (пока отдельный trust-card).
5. Circular Nest imports: Economy ↛ Escrow (OK).

## Stage 2 (запрещено до аудита)

Аналитика UI, рефералы, PRO биллинг UX, реальные PSP, финальная Trust Card UI на маркете.
