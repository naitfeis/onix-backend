# ONIX Auth V2 — Production Ed25519 Configuration Fix

| Field | Value |
| --- | --- |
| **Date** | 2026-07-15 |
| **Scope** | Production env only — no Auth V2 / Session / Token / LoginChallenge code changes |
| **Symptom** | `POST /api/v2/auth/telegram-bot/complete` → 503 `AUTH_ED25519_CURRENT_*` |

---

## 1. Call stack (exact)

```
BotLoginController.complete()
  safe-deal-platform/src/login-challenge/bot-login.controller.ts:82
    → this.challenges.complete(...)

LoginChallengeService.complete()
  safe-deal-platform/src/login-challenge/login-challenge.service.ts:231
    → this.orchestrator.loginWithVerifiedTelegramIdentity(...)

AuthOrchestrator.loginWithVerifiedTelegramIdentity()
  safe-deal-platform/src/auth-v2/auth-orchestrator.service.ts:84
    → this.sessions.issueTokensForSession(...)

SessionService.issueTokensForSession()
  safe-deal-platform/src/auth-v2/session.service.ts:101
    → this.tokens.issueAccessToken(...)

TokenService.issueAccessToken()
  safe-deal-platform/src/auth-v2/token.service.ts:52
    → this.signingKeys.getCurrentForSigning()

SigningKeyService.getCurrentForSigning()
  safe-deal-platform/src/auth-v2/signing-key.service.ts:37–44
    → AuthPlatformError AUTH_MISCONFIGURED
       "Ed25519 signing key is not configured (AUTH_ED25519_CURRENT_*)."
```

`JWT_SECRET` is **not** on this path. Bot `complete` issues **Auth V2 EdDSA** access + opaque refresh.

---

## 2. Exact env names (from code — not assumed)

`SigningKeyService` constants → `EnvSecretsProvider.get(name)` → `process.env[name]`:

| Required for CURRENT signing | Literal name |
| --- | --- |
| Kid | **`AUTH_ED25519_CURRENT_KID`** |
| Private PEM | **`AUTH_ED25519_CURRENT_PRIVATE_PEM`** |
| Public PEM | **`AUTH_ED25519_CURRENT_PUBLIC_PEM`** |

| Optional (rotation verify-only) | Literal name |
| --- | --- |
| Previous kid | `AUTH_ED25519_PREVIOUS_KID` |
| Previous public | `AUTH_ED25519_PREVIOUS_PUBLIC_PEM` |

**Wrong names (not read by code):**

- `AUTH_ED25519_CURRENT_PRIVATE_KEY` ❌  
- `AUTH_ED25519_CURRENT_PUBLIC_KEY` ❌  

Format: PKCS8 private PEM + SPKI public PEM (Node `ed25519`).

---

## 3. Generate keys

```bash
npm run auth:generate-ed25519
npm run auth:generate-ed25519 -- --render
npm run auth:generate-ed25519 -- --render --kid=onix-ed25519-1
```

Script: `safe-deal-platform/scripts/generate-ed25519.ts`  
Uses only `crypto.generateKeyPairSync('ed25519')` — same crypto family as `generateEd25519PemPair()` in TokenService tests.

---

## 4. Render instructions

1. Run `npm run auth:generate-ed25519 -- --render`
2. Render → `onix-api` → Environment → add:

```text
AUTH_ED25519_CURRENT_KID=<from script>
AUTH_ED25519_CURRENT_PRIVATE_PEM=<one-line with \n>
AUTH_ED25519_CURRENT_PUBLIC_PEM=<one-line with \n>
```

3. **Redeploy** Render service (env loads at process start; SigningKeyService caches on first use).
4. Retry Bot Login: start → confirm → **complete** → expect 200 + `Set-Cookie` refresh + `accessToken`.
5. `GET /api/v2/auth/me` with Bearer access (AuthV2Guard) — should return user.
6. For full Website bootstrap (`GET /api/users/me`, wallet, …) also set on Render:

```text
AUTH_ACCEPT_V2_ACCESS=true
```

(DualAccess on global AuthGuard — separate from signing keys; without it EdDSA access fails domain routes.)

---

## 5. Expected flow after fix

```
POST /telegram-bot/start     → Set-Cookie __Host-onix_ls
Telegram confirm             → CONFIRMED
POST /telegram-bot/complete  → Session + __Host-onix_rt + EdDSA access
GET /api/v2/auth/me          → User
refreshAll / bootstrap       → Guest → Authenticated (no reload)
```

---

## 6. Production env audit

### Required now (Bot Login complete)

| Env | Role |
| --- | --- |
| `DATABASE_URL` | Neon |
| `BOT_TOKEN` | Bot + InitData verify |
| `JWT_SECRET` | Legacy Mini App / widget HS256 |
| `AUTH_ED25519_CURRENT_KID` | **Missing → 503 on complete** |
| `AUTH_ED25519_CURRENT_PRIVATE_PEM` | **Missing → 503** |
| `AUTH_ED25519_CURRENT_PUBLIC_PEM` | **Missing → 503** |
| `CORS_ORIGINS` | Residual / local (single-origin browser less critical) |
| `TELEGRAM_BOT_USERNAME` or default | Deep links |

### Strongly recommended next

| Env | Role |
| --- | --- |
| `AUTH_ACCEPT_V2_ACCESS=true` | Domain APIs accept EdDSA after complete |
| `AUTH_COOKIE_SECURE` | Default secure/`__Host-` on HTTPS (leave unset on prod) |
| `TELEGRAM_WEBHOOK_SECRET` | Webhook auth |
| `WEBSITE_LOGIN_PROVIDER=bot` | Default already bot |
| `ADMIN_TELEGRAM_ID` | Admin bootstrap |

### Leave false / unused for now (do not enable casually)

| Env | Default | Note |
| --- | --- | --- |
| `USE_NEW_AUTH` | false | Canary |
| `AUTH_DUAL_ISSUE_SESSION` | false | Mini dual-issue |
| `AUTH_NEW_AUTH_CANARY_PERCENT` | 0 | |
| `AUTH_ROLLOUT_OBSERVE` | false | |

### Frontend (Vercel)

| Env | Value |
| --- | --- |
| `VITE_API_URL` | **empty** (single-origin) |
| `VITE_TELEGRAM_BOT_USERNAME` | bot username |

### Safe to ignore / not delete blindly

- `AUTH_ED25519_PREVIOUS_*` — only for key rotation  
- `VITE_API_PROXY_TARGET` — local Vite only  
- Wrong `*_PRIVATE_KEY` / `*_PUBLIC_KEY` if someone added them — unused by code; remove after PEM vars work  

---

## 7. What was changed in repo

| Change | Purpose |
| --- | --- |
| `scripts/generate-ed25519.ts` | Ops key generation |
| `npm run auth:generate-ed25519` | Script entry |
| `.env.example` | Document PEM env names |
| This report | Ops instructions |

**Not changed:** Auth V2, TokenService, SessionService, LoginChallenge, Bot, Website bootstrap, polling, crypto algorithm.
