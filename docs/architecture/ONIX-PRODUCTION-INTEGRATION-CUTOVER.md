# ONIX — Production Integration & Cutover Report

| Field | Value |
| --- | --- |
| **Document** | ONIX-PRODUCTION-INTEGRATION-CUTOVER |
| **Date** | 2026-07-15 |
| **Scope** | Website ↔ Backend ↔ Telegram Bot handshake (no Auth V2 / LoginChallenge / AuthManager rewrites) |
| **Frontend tests** | 45/45 (vitest) |

---

## Executive verdict

**Website bot login → complete → ONIX bootstrap without reload is wired.**

Telegram only proves `telegramId`. Profile, avatar, wallet, marketplace, roles come from **ONIX Database via Backend** (same paths as Mini App). Access stays in AuthManager memory; refresh uses `__Host-onix_rt`.

| Surface | Status |
| --- | --- |
| Handshake (start → poll → complete → bootstrap) | **Ready** (FE wired) |
| Persist (browser restart → refresh → /me → bootstrap) | **Ready** (FE wired) |
| No `location.reload()` on bot success | **Ready** |
| Poll stop / timeout / abort | **Ready** |
| Domain APIs with EdDSA access | **Ops gate:** staging/prod must set `AUTH_ACCEPT_V2_ACCESS=true` |
| `USE_NEW_AUTH` / canary | **Remain false** |

---

## 1. Architecture Review

Components as one platform:

```
Website SPA
  ├─ BotTelegramLogin (start / poll / complete | continue ?x=)
  ├─ AuthManager (memory access + single-flight refresh)
  ├─ useOnixCore (restore → GET /api/v2/auth/me → domain bootstrap)
  └─ api client (Bearer from AuthManager, 401 → one refresh retry)

Backend (unchanged cores)
  ├─ LoginChallenge + Bot webhook
  ├─ AuthOrchestrator.loginWithVerifiedTelegramIdentity
  ├─ SessionService / TokenService / IdentityLink
  └─ Domain: /api/users/me, wallet, products, orders, …

Telegram Bot — confirms ownership of telegramId only
Neon PostgreSQL — sole user data SoT
```

Frozen: Auth V2 Phase 1–3 cores, LoginChallenge module internals, SessionService, TokenService, IdentityLink semantics.

---

## 2. Sequence Diagram

```mermaid
sequenceDiagram
  actor U as User
  participant W as Website
  participant API as ONIX Backend
  participant B as Telegram Bot
  participant DB as Neon

  U->>W: Войти через Telegram
  W->>API: POST /api/v2/auth/telegram-bot/start
  API->>DB: LoginChallenge CREATED
  API-->>W: deepLink + challengeId
  W->>B: open t.me (new tab; SPA stays alive)
  U->>B: /start login_xxx
  B->>API: webhook confirm
  API->>DB: Challenge CONFIRMED (IdentityLink ↔ User)
  loop poll ≤120s, abortable
    W->>API: GET .../status
    API-->>W: PENDING | CONFIRMED | EXPIRED | CONSUMED
  end
  W->>API: POST .../complete
  API->>API: AuthOrchestrator → Session → Token
  API-->>W: accessToken + Set-Cookie refresh
  W->>W: AuthManager.setSession (memory)
  Note over W: polling stopped after one complete
  W->>API: GET /api/v2/auth/me
  W->>API: GET /api/users/me + ledger + products + orders + chats + notifications + reviews
  W->>W: Guest → Loading → Authenticated (no F5)
```

---

## 3. Data Flow

```
Telegram telegramId
    ↓ (confirm only)
IdentityLink
    ↓
ONIX User
    ↓
Profile / Wallet / Inventory / Marketplace / Roles (Neon)
    ↓
Backend DTO (/api/users/me, …)
    ↓
Website UI (UserAvatar, username, onixId, balance, roles)
```

**Forbidden:** reading profile/avatar from Telegram Widget / Bot API after confirm.

---

## 4. Bootstrap Review

After successful `complete` (or silent `restoreSession`):

| Step | Request | Service |
| --- | --- | --- |
| 1 | `POST /api/v2/auth/refresh` (if no memory access) | AuthManager |
| 2 | `GET /api/v2/auth/me` (once) | Auth V2 identity |
| 3 | `GET /api/users/me` | Profile (ONIX DB) |
| 4 | `GET /api/wallet/ledger` | Wallet history |
| 5 | `GET /api/products` | Marketplace |
| 6 | `GET /api/orders` | Deals |
| 7 | `GET /api/chats` | Chats |
| 8 | `GET /api/notifications` | Notifications |
| 9 | `GET /api/users/:onixId/reviews` | Reviews |

No new Website User model. Same `API_PATHS` / DTOs as Mini App.

---

## 5. Session Review

| Scenario | Expected |
| --- | --- |
| Refresh | AuthManager single-flight; api client 401 → one retry |
| Browser restart | memory empty → `restoreSession` → cookie refresh → /me → bootstrap |
| Logout / Logout All | existing Auth V2 endpoints (unchanged) |
| Website vs Mini App | Independent sessions (V2 cookie+memory vs Mini HS256 sessionStorage); same User via IdentityLink |

---

## 6. Performance Review

| Guard | Behaviour |
| --- | --- |
| Poll | Stops after CONFIRMED+complete; EXPIRED/CONSUMED/timeout/abort |
| Timeout | 120s default |
| Complete | Exactly one POST per successful wait |
| /me | Once per `refreshAll` session ensure |
| Bootstrap | One parallel batch after profile; no reload loop |
| Guest page load | One failed refresh attempt possible (silent restore) |

---

## 7. Production Readiness

### Ops checklist (required before prod traffic)

1. Apply LoginChallenge migration (`20260715150000_login_challenge`).
2. Bot webhook → `/api/telegram/webhook`; `BOT_TOKEN`; `WEBSITE_ORIGIN`.
3. Same-origin Website ↔ `/api` (empty `VITE_API_URL` + rewrite) for `__Host-onix_rt`.
4. Ed25519 signing keys present for Auth V2 issue.
5. **Staging/prod cutover flag:** `AUTH_ACCEPT_V2_ACCESS=true` so Website EdDSA access works on `/api/users/me`, wallet, marketplace (DualAccess). Keep `USE_NEW_AUTH=false`.
6. `WEBSITE_LOGIN_PROVIDER=bot` / `VITE_WEBSITE_LOGIN_PROVIDER=bot` (widget = rollback only).

### Surfaces

| Component | Integration |
| --- | --- |
| Website | Bot CTA → AuthManager → full bootstrap |
| Mini App | Unchanged `telegram-mini` + sessionStorage |
| Telegram Bot | Challenge confirm only |
| Neon | SoT via Prisma |
| Auth V2 / LoginChallenge / IdentityLink | Used as designed |

---

## 8. Definition of Done

| Criterion | Status |
| --- | --- |
| Auto-auth after Telegram confirm without reload | **Done** |
| Profile only from ONIX DB via Backend | **Done** |
| Avatar, name, ONIX ID, roles, balance in UI | **Done** (navbar + profile) |
| Mini App + Website same User / DTOs | **Done** (IdentityLink + shared API_PATHS) |
| Browser restart → refresh + /me + bootstrap | **Done** (FE path) |
| No Telegram Login Widget / oauth embed as default | **Done** (`bot` default) |
| No user duplication | **Architecture:** IdentityLink (unchanged) |
| No infinite poll / bootstrap loops | **Done** |
| Auth V2 / Session / Token / IdentityLink not rewritten | **Done** |

---

## Changed files (this cutover)

| File | Change |
| --- | --- |
| `onix-frontend/src/auth/botLogin.ts` | Abort/timeout poll; complete once; open Telegram without unloading SPA; `continueBotLogin` |
| `onix-frontend/src/auth/botLogin.test.ts` | Poll/complete/abort tests |
| `onix-frontend/src/auth/index.ts` | Export `continueBotLogin`, `BotLoginError` |
| `onix-frontend/src/api/client.ts` | `getBearerToken` + AuthManager `withAccessToken` on domain calls |
| `onix-frontend/src/hooks/useOnixCore.ts` | AuthManager restore + `/me` + full Mini-equivalent bootstrap |
| `onix-frontend/src/App.tsx` | No reload; abortable bot login; navbar identity sync |
| `docs/architecture/ONIX-PRODUCTION-INTEGRATION-CUTOVER.md` | This report |

---

## Test results

```
onix-frontend: vitest run → 45/45 passed
onix-frontend: tsc -b → pass
```

Manual e2e (ops): confirm on staging with `AUTH_ACCEPT_V2_ACCESS=true`, bot webhook, and same-origin cookie path before production cutover.

---

## Final readiness score

| Layer | Score |
| --- | --- |
| Frontend integration code | **95%** |
| Backend Auth V2 / LoginChallenge (prior freeze) | **Ready (additive)** |
| Production ops gate (`AUTH_ACCEPT_V2_ACCESS` + webhook + migration) | **Required before go-live** |
| **Overall production cutover** | **Ready after ops checklist** |
