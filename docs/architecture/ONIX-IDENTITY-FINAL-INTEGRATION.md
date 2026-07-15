# ONIX Identity — Final Integration (Same-URL SPA)

| Field | Value |
| --- | --- |
| **Date** | 2026-07-15 |
| **Principle** | ONIX Identity Platform; Telegram only proves `telegramId` |
| **SPA URL** | Unchanged (`https://onix.gg` / deploy host) — no `/login/continue`, no `?x=` |

---

## 1. Sequence diagram

```mermaid
sequenceDiagram
  actor U as User
  participant W as Website SPA
  participant API as ONIX Backend
  participant B as Telegram Bot
  participant DB as Neon

  U->>W: Войти через Telegram
  W->>API: POST /api/v2/auth/telegram-bot/start
  API->>DB: LoginChallenge CREATED
  API-->>W: challengeId + deepLink
  Note over W: URL unchanged; poll starts
  W->>B: open t.me (new tab)
  U->>B: Confirm
  B->>API: webhook confirmFromBot
  API->>DB: CONFIRMED + telegramId
  Note over API: No Session, no Set-Cookie, no returnUrl
  B-->>U: «Вход успешно подтверждён»
  W->>API: GET status → CONFIRMED
  W->>API: POST /complete (same origin)
  API->>DB: IdentityLink upsert User
  API->>DB: Session + refresh
  API-->>W: accessToken + Set-Cookie __Host-onix_rt
  W->>W: AuthManager.setSession
  W->>API: GET /api/v2/auth/me
  W->>API: bootstrap (/users/me, wallet, …)
  W->>W: Guest → Loading → Authenticated
```

Browser restart: `AuthManager.restoreSession` → `POST /refresh` → `/me` → bootstrap. Telegram not involved.

---

## 2. State machine

```
CREATED → OPENED → CONFIRMED → CONSUMED
                 ↘ EXPIRED
```

| Status | Meaning |
| --- | --- |
| **CONFIRMED** | Ready for Website `complete` (semantic “READY”) |
| **CONSUMED** | Session issued; challenge one-shot done |

No new Prisma enum. No `exchangeCode` issued on confirm.

---

## 3. Changed files

| File | Change |
| --- | --- |
| `login-challenge.service.ts` | confirm without returnUrl; exchange continue deprecated |
| `login-challenge.repository.ts` | `markConfirmed` without exchange hash |
| `bot-webhook.handler.ts` | Success message, no URL button |
| `botLogin.ts` | Poll→complete only; continue throws |
| `App.tsx` | Removed `?x=` continue effect |
| `bot-login-webhook-ux.test.ts` | Assert no return URL |
| This doc | Final integration report |

**Unchanged:** Auth V2 cores, AuthManager, SessionService, TokenService, IdentityLink, User/Session Prisma, Mini App bootstrap.

---

## 4. Why `/login/continue` is gone

SPA already polls. Redirect only served as a second channel when the browser tab was lost. Product requires a single URL and in-tab completion → redirect is redundant and harmful.

---

## 5. Why `returnUrl` is gone

`returnUrl` forced `WEBSITE_ORIGIN` and navigation. Webhook cannot deliver `__Host-` cookies to the Website browser. Session must be created on Website `complete`.

---

## 6. Website as Auth V2 client

Website uses: LoginChallenge → `complete` → `AuthOrchestrator.loginWithVerifiedTelegramIdentity` → SessionService + TokenService → refresh cookie + memory access → `/api/v2/auth/me` → same domain bootstrap as Mini App DTOs.

---

## 7. Persist after browser close

Refresh cookie from `complete` → `restoreSession` → `/refresh` → `/me` → bootstrap. No Telegram.

---

## 8. One User (Website + Mini App)

Both resolve via `telegramId` → IdentityService upsert / IdentityLink → same Neon `User` (wallet, orders, …).

---

## 9. Tests

Run: backend `npm test`, frontend `npm test` + `tsc -b`.

---

## 10. Production readiness

| Item | Status |
| --- | --- |
| Same-URL login | Done |
| No returnUrl / exchange login path | Done (continue endpoint returns error) |
| Cookie on Website complete only | Correct |
| Bot UX without redirect button | Done |
| Ops: webhook + `BOT_TOKEN` + `AUTH_ACCEPT_V2_ACCESS` | Still required |
| Mini App | Untouched |
