# ONIX Identity Platform — Phase D (Native Bot Login)

| Field | Value |
| --- | --- |
| **Document** | ONIX-IDENTITY-PLATFORM-PHASE-D |
| **Date** | 2026-07-15 |
| **Status** | Implemented (additive) |
| **Widget** | Stopped as product default — rollback via `WEBSITE_LOGIN_PROVIDER=widget` |

## Architecture Review

Telegram is an **Identity Provider** only (proves `telegramId`).  
ONIX DB is source of truth for User / Wallet / Orders / Sessions.

```
Website CTA → LoginChallenge (CREATED)
  → tg:// / t.me deep link
  → Bot OPENED → Confirm → CONFIRMED
  → Website poll → complete → AuthOrchestrator.loginWithVerifiedTelegramIdentity
  → SessionService + TokenService (unchanged)
  → __Host-onix_rt + AuthManager memory access → /me
```

**Frozen / reused:** SessionService, TokenService, SigningKeyService, refresh rotation, IdentityLink, AuthManager.  
**New:** LoginChallenge aggregate + LoginChallengeModule (depends on AuthOrchestrator only).

## Sequence Diagram

See chat delivery / mermaid below in report response.

## State Machine

`CREATED → OPENED → CONFIRMED → CONSUMED` (+ `EXPIRED` from CREATED/OPENED/CONFIRMED). TTL **2 minutes**. One-time consume.

## Feature Flags

| Flag | Default | Role |
| --- | --- | --- |
| `WEBSITE_LOGIN_PROVIDER` | `bot` | `bot` \| `widget` (rollback) |
| `VITE_WEBSITE_LOGIN_PROVIDER` | `bot` | Frontend mirror |

## Rollback

Set `WEBSITE_LOGIN_PROVIDER=widget` + `VITE_WEBSITE_LOGIN_PROVIDER=widget`. Widget + `/api/v2/auth/login` remain available. Mini App untouched.

## Persist Login

Unchanged Auth V2: browser restart → `POST /api/v2/auth/refresh` → access → `/me`. No Challenge.

## Ops

- Set BotFather webhook to `https://<api>/api/telegram/webhook`
- Optional `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_BOT_USERNAME` / `BOT_TOKEN` / `WEBSITE_ORIGIN`
