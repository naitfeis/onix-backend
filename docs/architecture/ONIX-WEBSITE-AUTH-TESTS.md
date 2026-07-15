# ONIX Website Auth — Test Checklist

| Field | Value |
| --- | --- |
| **Document** | ONIX-WEBSITE-AUTH-TESTS |
| **Date** | 2026-07-15 |
| **Parent** | ADD v1.4 · Phase Runbook · Website Auth Cutover |
| **Status** | Living checklist — fill during Phases A–E |
| **Backend** | Auth Phase 1–3 **FROZEN** — do not change flags/modules for these tests |

---

## 0. Rules

1. Backend Auth V2 modules, Prisma, Mini App contracts, and production feature flags stay frozen.
2. Do **not** enable `AUTH_ACCEPT_V2_ACCESS` / `USE_NEW_AUTH` until **Phase D.5 manual e2e** is signed off.
3. `vercel.json` rewrite must not be edited unless proxy is proven broken.
4. Temporary FE switch: `VITE_WEBSITE_AUTH_MODE=legacy|auth_v2` (delete after soak; not a permanent dual auth system).
5. After `POST /api/v2/auth/login` always call `GET /api/v2/auth/me` (Phase C+).

---

## 1. Automated tests

### Phase A (scaffolding)

| ID | Test | Status |
| --- | --- | --- |
| A-T01 | `resolveWebsiteAuthMode` defaults to `legacy` | ✅ Phase A |
| A-T02 | Mode accepts temporary `auth_v2` values | ✅ Phase A |
| A-T03 | Empty `VITE_API_URL` → relative `/api/...` + `credentials: include` | ✅ Phase A |
| A-T04 | Absolute `VITE_API_URL` → no forced credentials | ✅ Phase A |
| A-T05 | `createWebsiteAuthProvider('legacy')` wraps current behaviour | ✅ Phase A |
| A-T06 | Auth V2 provider stub does not call backend yet | ✅ Phase A |
| A-T07 | Existing Mini App / telegram-login client tests still green | ✅ Phase A |
| A-T08 | `vercel.json` unchanged when proxy already valid | ✅ Phase A |

### Phase B (AuthManager)

| ID | Test | Status |
| --- | --- | --- |
| B-T01 | Access token stored in memory only (not local/session storage) | ✅ Phase B |
| B-T02 | Single-flight refresh mutex | ✅ Phase B |
| B-T03 | **Refresh storm:** 20 parallel callers → exactly **1** refresh call | ✅ Phase B |
| B-T04 | Refresh sends `X-ONIX-CSRF: 1` + credentials | ✅ Phase B |
| B-T05 | Missing refresh cookie → clear session / re-login | ✅ Phase B |
| B-T06 | Cross-tab BroadcastChannel logout / token update | ✅ Phase B |
| B-T07 | Proactive refresh before access expiry | ✅ Phase B |
| B-T08 | 401 → refresh → retry → success | ✅ Phase B |
| B-T09 | 401 → refresh 401 → logout, no loops | ✅ Phase B |
| B-T10 | Silent refresh after reload restores session | ✅ Phase B |
| B-T11 | Refresh Cancellation (logout during refresh discards token) | ✅ Phase B |
| B-T12 | Double Logout (A then B, no exceptions) | ✅ Phase B |
| B-T13 | Refresh queue 30 waiters / 1 HTTP refresh | ✅ Phase B |
| B-T14 | Singleton: one AuthManager for all AuthV2 providers | ✅ Phase B |

### Phase C (V2 login)

| ID | Test | Status |
| --- | --- | --- |
| C-T01 | Widget → `POST /api/v2/auth/login` with coerced telegram `id` string | ✅ Phase C |
| C-T02 | After login **always** `GET /api/v2/auth/me` | ✅ Phase C |
| C-T03 | Set-Cookie refresh received on same-origin | ✅ credentials include |
| C-T04 | Access only in memory after login | ✅ Phase C |
| C-T05 | `VITE_WEBSITE_AUTH_MODE=legacy` still uses `/telegram-login` | ✅ Phase C |
| C-T06 | Mini App path unchanged (`/telegram-mini` + sessionStorage) | ✅ Phase C |
| C-T07 | Login failure → empty AuthManager | ✅ Phase C |
| C-T08 | /me failure → clear session | ✅ Phase C |
| C-T09 | Logout clears AuthManager | ✅ Phase C |

### Phase D (interceptors + sessions UX)

| ID | Test | Status |
| --- | --- | --- |
| D-T01 | Bearer from memory on domain requests | ☐ |
| D-T02 | 401 → single refresh → one retry | ☐ |
| D-T03 | Refresh storm under interceptor (N requests, 1 refresh) | ☐ |
| D-T04 | Logout clears memory + cookie | ☐ |
| D-T05 | Logout all devices | ☐ |
| D-T06 | Session list + revoke other session | ☐ |
| D-T07 | Cross-tab logout sync | ☐ |
| D-T08 | Reload → silent restore via refresh cookie | ☐ |

---

## 2. Phase D.5 — Full manual e2e (required before any backend flag)

Run on **same-origin** staging (empty/`unset` `VITE_API_URL`, Vercel `/api` rewrite).  
`VITE_WEBSITE_AUTH_MODE=auth_v2`.  
Backend flags still at defaults (`AUTH_ACCEPT_V2_ACCESS=false` until this checklist passes).

| Step | Action | Expected | Pass |
| --- | --- | --- | --- |
| M01 | Open Website (logged out) | Guest / login prompt | ☐ |
| M02 | Telegram Login Widget | Callback fires | ☐ |
| M03 | Login completes | `POST /api/v2/auth/login` 200 | ☐ |
| M04 | Immediate me | `GET /api/v2/auth/me` 200; UI shows user | ☐ |
| M05 | DevTools → Application → Cookies | `__Host-onix_rt` HttpOnly Secure | ☐ |
| M06 | DevTools → Application → Storage | **No** access JWT in local/session storage | ☐ |
| M07 | Hard refresh (F5) | Silent refresh; user still authenticated | ☐ |
| M08 | Marketplace browse | Products load (or expected auth gate documented) | ☐ |
| M09 | Orders | Loads without forced re-login | ☐ |
| M10 | Wallet / ledger | Loads without forced re-login | ☐ |
| M11 | Logout | Cookie cleared; guest state | ☐ |
| M12 | Login again | New session | ☐ |
| M13 | Logout All | All sessions revoked; cookie cleared | ☐ |
| M14 | Login → open 2nd tab | Both authenticated | ☐ |
| M15 | Logout in tab A | Tab B loses session (cross-tab) | ☐ |
| M16 | Login → wait / force expired access | Auto refresh; no full page login | ☐ |
| M17 | Parallel API spam while expired | **One** refresh in Network tab (storm test) | ☐ |
| M18 | Refresh rotation | Second refresh gets new cookie; old refresh rejected | ☐ |
| M19 | Sessions UI → revoke other device | Target gone; current remains | ☐ |
| M20 | Force 401 after revoke current | Auto retry fails cleanly → login | ☐ |

**Sign-off**

| Role | Name | Date |
| --- | --- | --- |
| Engineer | | |
| Reviewer | | |

Only after M01–M20 pass: discuss enabling **staging** `AUTH_ACCEPT_V2_ACCESS=true` (Phase E).  
Production `USE_NEW_AUTH` remains out of scope until ops checklist.

---

## 3. Phase E (staging dual-accept) — after D.5

| ID | Check | Status |
| --- | --- | --- |
| E-T01 | Staging `AUTH_ACCEPT_V2_ACCESS=true` only | ☐ |
| E-T02 | Domain APIs accept Ed25519 Bearer | ☐ |
| E-T03 | Mini App still HS256-only / green | ☐ |
| E-T04 | Rollback: flag false + FE mode legacy | ☐ |
| E-T05 | Prod flags unchanged | ☐ |

---

## 4. Production safety (every increment)

| Check | Pass |
| --- | --- |
| No backend Auth module edits | ☐ |
| No Prisma / migration changes | ☐ |
| No production feature flag flips | ☐ |
| Mini App client path unchanged | ☐ |
| `vercel.json` untouched unless proxy broken | ☐ |
| Rollback path documented for the increment | ☐ |

---

## 5. Refresh storm (normative)

```
Given access token is expired
When 15 authenticated API requests start in parallel
Then exactly 1 POST /api/v2/auth/refresh is sent
And all 15 waiters receive the new access token (or fail together if refresh fails)
And no refresh-family reuse revoke is triggered by the client
```

Automated coverage: **B-T03**, **D-T03**. Manual: **M17**.
