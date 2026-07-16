# ONIX Auth V2 Website Session Audit

| Field | Value |
| --- | --- |
| **Date** | 2026-07-16 |
| **Scope** | Website persistent session (Mini App unchanged) |

---

## Problem (observed)

| | VPN | No VPN |
| --- | --- | --- |
| session | OK | **401** |
| restore-session | 226ms | **12007ms** |
| bootstrap | 495ms | **42158ms** |

Note: phase name `restore-session` = **old frontend bundle**. Current source uses `auth-session` and never refreshes after session 401.

---

## 1. Why cookie is missing / not sent (401)

`GET /api/v2/auth/session` → `AUTH_REFRESH_MISSING` when `__Host-onix_rt` is absent or unknown.

Typical no-VPN causes (cookie strategy unchanged):

| Cause | Effect |
| --- | --- |
| Cookie never set after first login (login/`complete` failed or Set-Cookie dropped) | 401 forever until re-login |
| Request not same-origin `www…/api` (e.g. absolute `api.` host) | `__Host-` cookie not sent |
| Expired / cleared / different browser profile | 401 |
| Slow path still had **old** client calling refresh after 401 | **12s hang** (not cookie crypto) |

Probe: `GET /api/debug/session` → `{ cookiePresent, host, origin, userAgent, secure, sameSite }` (no tokens).

Cookie attributes (unchanged):

- Name: `__Host-onix_rt`
- Secure=true, HttpOnly=true, Path=/, SameSite=Lax, **no Domain**

---

## 2. Auth bootstrap flow (website)

```
open website → render shell
    ↓
start GET /products (background)
    ↓
GET /api/v2/auth/session  (≤2.5s)
    ↓
401/403 → guest immediately  → bootstrap-settled  (do NOT await products)
200     → POST /refresh → GET /users/me → settle
```

Telegram: **not** used for restore. Only explicit login (AuthGate).

Mini App: still Telegram `initData` auto-login (separate path).

---

## 3. Fixes in this pass

| Issue | Fix |
| --- | --- |
| Refresh after session 401 | **Forbidden** — guest return, no `POST /refresh` |
| Guest blocked on products hang (~40s) | Guest settle **without** awaiting products |
| Session client timeout | **2.5s**, no retry |
| Timing | `auth-session`, `cookie-check`, `refresh`, `bootstrap` |
| Debug | `GET /api/debug/session` shape aligned |

---

## 4. Before / after

| Metric | Before (no VPN, old client) | After (this source) |
| --- | --- | --- |
| session 401 → guest | after refresh ~12s | **immediate** (session RTT) |
| restore-session | ~12007 ms | **removed** (use `auth-session`) |
| bootstrap-guest | ~22–42s (await products/refresh) | **target &lt;2s** (session only) |
| VPN happy path | ~0.5s | unchanged |

If console still shows `restore-session=12007ms`, **redeploy frontend** — that build predates this flow.

---

## Confirmations

- Ed25519 / Auth V2 / cookie names / API contract / design / business logic — not changed  
- Telegram not used for website session restore  
- No refresh after session 401  
