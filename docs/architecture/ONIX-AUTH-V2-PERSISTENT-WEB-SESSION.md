# ONIX Auth V2 — Persistent Web Session Audit

| Field | Value |
| --- | --- |
| **Date** | 2026-07-16 |
| **Goal** | Telegram only for first login; afterward ONIX HttpOnly cookie session |
| **Constraints** | No Auth cookie strategy change; no business-logic / design / existing API contract rewrites |

---

## Old flow (before)

```
Boot (www)
  → import @twa-dev/sdk (static)
  → WebApp.ready() / expand() (always attempted)
  → bootstrapAuth() / Mini App initData path even on ordinary web
  → or cookie refresh (if Auth V2)
  → market

Problems:
  - Telegram SDK on critical path for ordinary website
  - Mandatory Telegram restore attempts when Mini App API flaky
  - Waiting / probing Telegram before app usable
  - Logout / guest state when Telegram temporarily unavailable
  - rememberMe often omitted → shorter idle cookie TTL (14d vs 30d)
```

Measured prod baseline (no VPN, prior bootstrap audit):

| Metric | Before |
| --- | --- |
| ttfb | ~74 ms |
| dom-interactive | ~22 114 ms (JS download/parse; not auth alone) |
| bootstrap-settled | ~34 166 ms (auth waterfall + extras) |

---

## New flow (after)

```
Telegram Login (first time only)
  → validate initData / widget / bot challenge
  → find/create User
  → create ONIX session (rememberMe=true by default on Website)
  → Set-Cookie: __Host-onix_rt (HttpOnly, Secure, SameSite=Lax)

Subsequent boots (reload / new tab / next day)
  → NO @twa-dev/sdk on www critical path
  → NO WebApp.ready wait
  → AuthManager.restoreSession() → POST /api/v2/auth/refresh (cookie)
  → GET /users/me + products (critical path)
  → market

Mini App only (initData present):
  → signalTelegramReadyIfMiniApp()
  → optional bootstrapAuth() if cookie restore failed
```

### Added endpoint (additive; existing routes unchanged)

`GET /api/v2/auth/session`

- Cookie only (`__Host-onix_rt`)
- No Bearer, no Telegram, **no refresh rotation**
- Response: `{ authenticated, cookiePresent, user, session }` (no token values)

Client helper: `getAuthV2Session()`.

### Frontend decoupling

| Change | Effect |
| --- | --- |
| `auth/telegramEnv.ts` | Detect Mini App via `window.Telegram.WebApp` without SDK |
| Removed static `@twa-dev/sdk` from `App.tsx`, `useOnixCore.ts`, `api/client.ts` | Ordinary www bundle does not load Telegram SDK |
| `ensureWebsiteOrMiniAuth` | Cookie restore first; Mini Auth **only** if `isTelegramMiniApp()` |
| Bot + Widget login | `rememberMe: true` by default |

### Persistence checks

| Scenario | Expected |
| --- | --- |
| Reload (F5) | Cookie → refresh → market; no Telegram |
| Close browser, reopen | Cookie survives (`Secure` + Max-Age from rememberMe idle ~30d) |
| Return next day | Same; within idle/absolute TTL (30d remember / 90d absolute) |

---

## Bootstrap time — before / after

| Metric | Before | After (expected) |
| --- | --- | --- |
| telegram phase (www) | SDK + ready + possible mini auth | **~0 ms** (no-op if not Mini App) |
| restore-session / refresh | Present; often after Telegram | **First** auth step on www |
| blocking `/v2/auth/me` | Was on path earlier | Already removed; profile = `/users/me` |
| bootstrap-settled | ~34 s (prod sample) | Auth portion − Telegram RTT/hang; settle ≈ refresh + me + products |
| dom-interactive | ~22 s | Unchanged by auth alone (JS delivery); SDK chunk gone helps slightly |

Ops console (www, already logged in):

```
[bootstrap]
telegram=0 ms
restore-session=<refresh ms>
refresh=<same>
me=…
products=…
bootstrap-settled=…
```

Guest (no cookie):

```
[bootstrap]
telegram=0 ms
restore-session=<fast fail>
bootstrap-guest=…
```

---

## Explicitly forbidden (enforced)

- Required Telegram restore on every www launch  
- Waiting for `Telegram.ready` before app load on www  
- Logout because Telegram SDK / WebApp is temporarily unavailable  

---

## Files touched

**Backend:** `auth-v2.controller.ts` (`GET session`), `session.service.ts` (`getSessionByRefreshToken`)

**Frontend:** `telegramEnv.ts`, `useOnixCore.ts`, `App.tsx`, `api/client.ts`, `botLogin.ts`, `AuthV2WebsiteAuthProvider.ts`, `v2AuthApi.ts`, `auth/index.ts`
