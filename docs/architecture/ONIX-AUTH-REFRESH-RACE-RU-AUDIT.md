# ONIX Auth — Refresh call graph + RU session drop (2026-08-13)

## Root cause (why RU session “flies away”)

| Finding | Detail |
| --- | --- |
| **`GET /api/session-probe` → 404 in production** | Backend registers `SessionProbeController` only when `ENABLE_DEBUG_ENDPOINTS=true` or `NODE_ENV≠production` (`debug-endpoints.ts`). Prod = **off**. |
| **Frontend still called probe first** | `probeRefreshCookiePresence()` → 404 classified as **`network`** (not guest). |
| **Network path always refreshed** | `restoreWebsiteSession`: probe network → `refreshAccessToken()`. |
| **Then soft-retry after 2s** | Another `restoreWebsiteSession()` → **second refresh** after first finished → refresh **rotation race** → `AUTH_REFRESH_REUSED` / 401 → `clearSession` → LoggedOut. |
| **SW FetchEvent no-response** | Stale Workbox + 404 probe: `FetchEvent /api/session-probe` with no handler response. |

Access token can still work briefly while refresh cookie is rotated out from under a losing refresh → next API 401 → more refresh → logout.

---

## Refresh call graph (before fix)

```
App start (www)
  └─ useOnixCore.refreshAll
       └─ restoreWebsiteSession
            ├─ probeRefreshCookiePresence → GET /api/session-probe  ❌ 404
            │     └─ reason: network
            └─ AuthManager.refreshAccessToken → POST /api/v2/auth/refresh  ← #1
  … 2s later (bootstrap-network soft retry) …
       └─ restoreWebsiteSession again
            └─ refreshAccessToken → POST /refresh  ← #2 (race with #1 if overlapping / rotation)

Also:
  apiRequest → withAccessToken → ensureAccessToken → refreshAccessToken  (if memory token missing/expired)
  AuthManager proactive timer → refreshAccessToken
  AuthV2WebsiteAuthProvider.logout → refreshAccessToken (best-effort)
  AuthManager.restoreSession → refreshAccessToken
  Multi-tab: each tab has own AuthManager → single-flight does NOT cross tabs (BroadcastChannel race helper exists)
```

### Not calling refresh

| Event | Effect |
| --- | --- |
| `visibilitychange` / `focus` | presence heartbeat only (`/me/presence`) — **no refresh** |
| `pageshow` / `online` | **no** auth restore hook |
| Service worker | NetworkOnly for `/api/*` (when SW is current) |

---

## AuthManager single-flight

**Yes, in-process:** `refreshInFlight` shared promise.

**Does not cover:**
- second call after `finally { refreshInFlight = null }` (soft retry 2s later)
- second **browser tab** (separate JS heap)
- `resilientFetch` retries (look like multiple POSTs, sequential)

---

## Fix applied

1. **Website restore = refresh only** (no `/api/session-probe`).
2. Soft retry: prefer existing access token; otherwise one more restore (still single AuthManager).
3. PWA: `autoUpdate` + `skipWaiting` + `clientsClaim` + `cleanupOutdatedCaches`; auth paths NetworkOnly (GET+POST); drop session-probe from SW special list.
4. Refresh transport `maxRetries: 1` (was 3).

### New bootstrap

```
App start
  → AuthManager.refreshAccessToken()   // cookie → access
  → GET /api/users/me                  // profile
  → authenticated | guest | network
```

---

## Ops after deploy (RU)

1. Hard refresh / close all ONIX tabs once (kill old SW).
2. Application → Service Workers → unregister any old controller if needed.
3. Expect **one** `POST /api/v2/auth/refresh` on cold start (or zero if access still in memory).
4. Confirm **no** `GET /api/session-probe` in Network.
