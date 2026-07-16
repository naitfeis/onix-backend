# ONIX Auth Cookie Debug — RU without VPN

| Field | Value |
| --- | --- |
| **Date** | 2026-07-16 |
| **Scope** | Cookie / refresh latency — no Auth V2 redesign |
| **Frontend API** | Same-origin `www.onixtg.shop/api/*` (Vercel → Render) |
| **Cookie** | `__Host-onix_rt` |

---

## 1. Refresh cookie flow

### Create (Set-Cookie)

| Step | Where |
| --- | --- |
| Issue opaque refresh | `SessionService` / `TokenService.issueRefreshToken` |
| Set cookie | `buildRefreshCookieHeader` in `auth-v2/refresh-cookie.ts` |
| Call sites | `POST /api/v2/auth/login`, bot `complete`, `POST /api/v2/auth/refresh` (rotation) |

### Attributes (production)

| Attribute | Value |
| --- | --- |
| Name | `__Host-onix_rt` |
| HttpOnly | yes |
| Secure | yes (`AUTH_COOKIE_SECURE` ≠ false) |
| SameSite | **Lax** |
| Path | `/` |
| Domain | **none** (`__Host-` forbids Domain) |
| Max-Age | remember / session TTL seconds |

### Read

| Step | Where |
| --- | --- |
| Cookie header | Browser sends only to **host that set it** |
| Parse | `readRefreshTokenFromCookie` on `POST /api/v2/auth/refresh` |
| CSRF | requires `X-ONIX-CSRF: 1` |

### Critical: www → api.onixtg.shop

**Cannot work with current Auth V2 cookie design.**

- `__Host-onix_rt` is **host-only** on `www.onixtg.shop` when set via `www…/api`.
- Requests to `https://api.onixtg.shop` **do not** include that cookie.
- Changing to `Domain=.onixtg.shop` + `SameSite=None` would be an Auth cookie strategy change (explicitly out of scope).

**Keep:** browser → `www.onixtg.shop/api/*` (same-origin).  
`api.onixtg.shop` Custom Domain is fine for health/ops, not for Website Auth cookies.

### Telegram WebView RU

Cookie storage is fine for first-party `www` if login completed on that host.  
Observed logout is usually: **refresh AbortError → AuthManager clears session**, not “cookie deleted by WebView”.

---

## 2. Why refresh ≈ 8 seconds then 201 / AbortError

### Root cause (client)

Previous `resilientFetch` policy:

1. Attempt #1 hangs (slow RU → Vercel rewrite first byte).
2. AbortController fires at **8_000 ms**.
3. **Timeout was retried** → attempt #2 often succeeds → **HTTP 201 after ~8s**.
4. Parallel `/me` / `/products` share the abort / fail with **AbortError**.
5. `restoreSession` fails → user appears logged out.

This matches: health OK (fast GET), refresh “201 in 8s”, me/products AbortError.

### Fix (this pass)

- **Do not retry** our own timeout AbortError (only fast `Failed to fetch` / reset).
- Default timeout **12s** (single wait, no double 8s).
- Refresh transport uses the same policy.

### Server-side

Refresh does several Prisma round-trips (session lookup, user, transaction, trustedDevice).  
Added **Server-Timing**: `refresh-total`, `refresh-db`, `refresh-token` on `POST /api/v2/auth/refresh`.  
If `refresh-db` is hundreds of ms while total wall time is seconds → latency is **network/proxy**, not Nest.

---

## 3. CORS

| Setting | Status |
| --- | --- |
| Origins | `https://www.onixtg.shop`, `https://onixtg.shop` (+ localhost) |
| credentials | `true` |
| Probe | OPTIONS → 204, `Access-Control-Allow-Credentials: true` |

Same-origin XHR does not need CORS for www→www/api; CORS matters if anything called `api.` from www.

---

## 4. Debug endpoint

`GET /api/debug/session` (no token values):

```json
{
  "cookiePresent": true,
  "cookieName": "__Host-onix_rt",
  "origin": "...",
  "userAgent": "...",
  "host": "www.onixtg.shop",
  "secure": true,
  "sameSite": "Lax",
  "path": "/",
  "httpOnly": true,
  "domain": null,
  "note": "..."
}
```

Use from RU WebView Network tab **with credentials** (same-origin page).

---

## 5. Expected after deploy

| Check | Target |
| --- | --- |
| First open | &lt; 2s shell |
| refresh | &lt; 300ms warm **server**; wall &lt; 1–2s RU |
| /me | &lt; 300ms warm |
| Session after reload | cookiePresent true + refresh OK |

### Verify

1. Chrome RU no VPN: login → reload → `/api/debug/session` → `cookiePresent: true`.
2. Telegram WebView same URL: refresh Server-Timing `refresh-total` / `refresh-db`.
3. Confirm refresh no longer sits exactly ~8.0s then 201.
