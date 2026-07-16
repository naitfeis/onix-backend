# ONIX Auth V2 Persistent Session Audit — Website

| Field | Value |
| --- | --- |
| **Date** | 2026-07-16 |
| **Scope** | Website only (Mini App unchanged) |
| **Constraints** | No Ed25519 / Auth V2 crypto / cookie name / API contract / business-logic changes |

---

## Symptom

| Path | Observation |
| --- | --- |
| **Without VPN** | `GET /api/v2/auth/session` → **401**; then `restore-session≈12007ms` → `bootstrap-guest≈22s` → settle ≈42s |
| **With VPN** | session OK; refresh≈226ms; me≈268ms; products≈156ms; bootstrap &lt;1s |

---

## Root cause of the 12s wait

Frontend called **`POST /api/v2/auth/refresh` first** (`AuthManager.refreshAccessToken` via `resilientFetch` **timeoutMs=12_000**).

When the cookie is **missing/invalid**, refresh hangs until that timeout → `restore-session=12007ms` — even if `/session` already returned **401**.

**401 was not converted to guest immediately**; it was discovered only after the refresh timeout (or a late probe).

Telegram was not the 12s cause here; the **refresh timeout** was.

---

## Why session is 401 without VPN

`GET /api/v2/auth/session` returns `AUTH_REFRESH_MISSING` when:

1. **`__Host-onix_rt` cookie is not present** on the request (most common), or  
2. Cookie present but hash unknown / session revoked / expired.

VPN works because the cookie is present and the API is reachable quickly (refresh+me+products &lt;1s).

Without VPN, 401 means **no usable cookie reached the API** (never set after login, stripped on path, wrong host, or expired) — **not** Ed25519 failure. Cookie strategy (`__Host-`, SameSite=Lax, Secure, Path=/) unchanged; first login must still succeed once with Set-Cookie on `www` same-origin `/api`.

---

## Fix (website bootstrap)

```
OPEN SITE → render shell
    ↓
Parallel:
  GET /api/v2/auth/session  (≤4s, no retry)
  GET /api/products
    ↓
session 401/403 → guest immediately (no refresh wait)
session 200 → POST refresh (mint access) → GET /users/me
    ↓
Telegram only on explicit login (AuthGate)
```

| Change | Effect |
| --- | --- |
| Session probe **before** refresh | 401 → guest in RTT, not 12s |
| Session client timeout **4s**, `maxRetries: 0` | Fail fast |
| Products **parallel** with session | Marketplace not blocked by auth |
| Mini App path | Unchanged (Telegram auto-login first) |

Backend: `Server-Timing` on `/session` — `auth-session`, `cookie-check`, `db-session-lookup`.

---

## Before / after

| Metric | Before (no VPN) | After (expected) |
| --- | --- | --- |
| session 401 → guest | after ~12s refresh | **immediate** (session RTT) |
| `restore-session` / hang | ~12007 ms | **removed** from guest path |
| `auth-session` | n/a / late | ≤ ~4s (usually ≪) |
| bootstrap-guest | ~22s | ~max(session, products) |
| first shell render | blocked by auth wait | **shell first**, then parallel |
| VPN happy path | &lt;1s | unchanged (session 200 → refresh → me) |

---

## Files

- `onix-frontend/src/hooks/useOnixCore.ts` — website session-first + parallel products  
- `onix-frontend/src/auth/v2AuthApi.ts` — fast session fetch  
- `onix-frontend/src/perf/bootstrapTiming.ts` — `auth-session` phase  
- `safe-deal-platform/src/auth-v2/auth-v2.controller.ts` — Server-Timing on session  

---

## Confirmations

- Auth V2 / Ed25519 / cookie names / API contract preserved  
- Telegram not used for website restore  
- 401 → guest without 12s wait  
