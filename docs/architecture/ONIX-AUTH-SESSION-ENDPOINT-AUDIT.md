# ONIX — GET /api/v2/auth/session audit

| Field | Value |
| --- | --- |
| **Date** | 2026-07-16 |
| **Endpoint** | `GET /api/v2/auth/session` |
| **Not changed** | Auth V2 crypto · Ed25519 · refresh rotation · cookie name/flags |

---

## Facts vs probe

| Observation | Interpretation |
| --- | --- |
| Browser: session = **2507ms** | Exact match of FE `resilientFetch` timeout **2500ms** → **client Abort**, not Nest CPU |
| Render: request **absent** from logs | Request often **never reaches** Nest (or aborts before handler log) on the RU path |
| `GET /api/products` = 67ms | Same Vercel→Render rewrite works |
| `GET /api/debug/session` fast, `cookiePresent=true` | Cookie header arrives; debug does **no DB** |
| EU curl without cookie | Nest **`X-Response-Time: ~1ms`**, 401 `AUTH_REFRESH_MISSING` |

**Conclusion:** 2.5s is almost certainly a **hung hop / client timeout**, not a slow session handler. When the request does hit Nest without a cookie, it already returns in &lt;50ms.

---

## Implementation

| Piece | Location |
| --- | --- |
| Controller | `auth-v2.controller.ts` → `GET v2/auth/session` |
| Lookup | `SessionService.getSessionByRefreshToken` |
| Cookie parse | `readRefreshTokenFromCookie` (`__Host-onix_rt`) |

### Lightweight path (after fix)

```
cookie parse
  → missing → 401 immediately
  → sha256(hash)
  → one findUnique(session + user select)
  → assert session TTL / revoked
  → read-only ban check (no BAN_CLEAR write)
  → 200
```

**Removed from probe path:** second user query, `resolveUserAccountLock` write, Telegram, refresh, permissions, profile, orders, chats.

### Timing headers

`Server-Timing`: `cookie-parse`, `hash`, `session-lookup`, `database-query`, `user-lookup`, `response`, `auth-session`  
Plus entry log: `GET /v2/auth/session start` so Render shows the hit even if the client aborts later.

`request-timing.middleware` now **appends** `app` instead of wiping controller phases.

---

## Goal

| Case | Target |
| --- | --- |
| No cookie | **&lt;50ms** Nest (already ~1ms) |
| Cookie present, warm DB | **&lt;200ms** Nest |
| Browser 2507ms with no Render log | Network / edge — measure `Server-Timing` when the request completes; compare with/without VPN |

Auth V2 / Ed25519 / refresh / cookie strategy unchanged.
