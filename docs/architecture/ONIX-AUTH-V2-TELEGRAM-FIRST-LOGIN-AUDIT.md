# ONIX Auth V2 Audit — Telegram only first login

| Field | Value |
| --- | --- |
| **Date** | 2026-07-16 |
| **Scope** | Additive client fixes only — no JWT, no Auth V2 / Ed25519 / API / UI / business-logic changes |

---

## Checklist

| # | Check | Result |
| --- | --- | --- |
| 1 | Reopen site without Telegram context | **OK** — cookie `restoreSession` → refresh; Mini Auth only if `initData` present |
| 2 | Open from RU without VPN | **OK path** — same-origin `/api` + `__Host-onix_rt`; no Telegram SDK on critical path |
| 3 | Cookie expiry / restore | **OK** — idle ~14d / remember ~30d / absolute 90d; Website login defaults `rememberMe=true` |
| 4 | Session loss on network delay | **Was real bug → fixed** (see below) |
| 5 | Blocking `await` Telegram SDK before app load | **OK** — no `@twa-dev/sdk` import; `signalTelegramReadyIfMiniApp` is sync no-op on www |
| 6 | Logout on temporary network error | **Was real bug → fixed** |

---

## Where Telegram dependency was

| Location | Old behavior | Now |
| --- | --- | --- |
| Static `@twa-dev/sdk` in App / client / core | Bundle + ready on every boot | Removed; `telegramEnv.ts` reads `window.Telegram` only if present |
| `bootstrapAuth()` on www | Tried Mini App even without context | Only when `isTelegramMiniApp()` |
| `WebApp.ready()` before React | Blocking ritual | No-op unless Mini App |
| Login (bot / widget / mini) | First identity proof (Ed25519 / initData) | Unchanged — **only** first login |

After first successful Telegram verification the server creates an ONIX session and sets `__Host-onix_rt`. Further boots use **cookie refresh only**.

---

## Real bug fixed (item 4 / 6)

**Cause:** `AuthManager.refreshAccessToken()` called `clearSession('refresh-failed')` on *any* error, including Abort/timeout/`Failed to fetch`. That broadcast `force-reauth` and made the UI look logged-out while the HttpOnly cookie was still valid — common on slow RU paths (~8–12s).

**Fix (additive):**

- `isDefinitiveAuthRefreshFailure` / `isTransientRefreshFailure` in `refreshClient.ts`
- Clear session **only** on definitive auth codes/401–403
- Network/5xx → `AUTH_NETWORK_TRANSIENT`; keep memory token + cookie
- Bootstrap: if refresh is transient, probe `GET /api/v2/auth/session` → show “Сессия ONIX сохранена — обновите” instead of forcing Telegram re-login
- Provider `/me` failures: no `force-reauth` on transient/5xx

---

## Files changed

| File | Change |
| --- | --- |
| `onix-frontend/src/auth/refreshClient.ts` | Transient vs definitive refresh errors |
| `onix-frontend/src/auth/AuthManager.ts` | Logout only on definitive refresh failure |
| `onix-frontend/src/auth/AuthV2WebsiteAuthProvider.ts` | No force-reauth on transient `/me` |
| `onix-frontend/src/hooks/useOnixCore.ts` | Cookie-first boot; `network` vs `guest` |
| `onix-frontend/src/auth/index.ts` | Export helpers |
| `onix-frontend/src/auth/AuthManager.test.ts` | Network-does-not-logout test |

(Prior additive work still relevant: `GET /api/v2/auth/session`, `telegramEnv.ts`, `rememberMe` defaults — no Auth V2 crypto changes.)

---

## Auth flow now

```
First login (Telegram once)
  → bot/widget/mini signature verify (Ed25519 / initData)
  → create ONIX session + Set-Cookie __Host-onix_rt
  → access token in memory

Every later visit (no Telegram)
  → POST /api/v2/auth/refresh (cookie + CSRF)
  → Bearer access for /api/*
  → optional GET /api/v2/auth/session (probe, no rotation)

Transient network during refresh
  → do NOT clear session / do NOT require Telegram
  → user refreshes page when network returns
```

---

## Session restore timing

| Phase | Before (problem) | After |
| --- | --- | --- |
| www `telegram` | SDK / ready / mini attempt | **~0 ms** |
| `restore-session` / refresh | ~1 RTT; on timeout **logout** | ~1 RTT; on timeout **keep cookie** |
| False guest → Telegram re-login | Common on RU delay | Avoided when cookie still valid |
| Successful restore (warm cookie) | refresh + me + products | Same critical path (no Telegram) |

Prod baseline when Telegram was still on the path: bootstrap-settled ~34s (mostly JS download + waterfall). Auth restore itself is one refresh RTT; the regression was **false logout**, not slow crypto.
