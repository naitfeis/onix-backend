# ONIX Key Rotation Runbook (Slice 5)

| | |
| --- | --- |
| **Updated** | **2026-09-10** |

Ops procedures for rotating signing and HMAC secrets.  
Backend remains **ENV via `SecretsProvider`** — Vault/KMS adapter is a later slice.

**Never** paste private PEM, HMAC, JWT, delivery key, or Slack webhook values into tickets, chat, or audit metadata.

---

## 1. Security domains (do not mix)

| Domain | Env | Purpose | Rotation impact |
|--------|-----|---------|-----------------|
| Access JWT (Auth V2) | `AUTH_ED25519_CURRENT_*` (+ optional `PREVIOUS_*`) | Sign/verify short-lived EdDSA access tokens | Old access still verifies via PREVIOUS until TTL (~15m) |
| Device trust | `DEVICE_HMAC_SECRET` | HMAC → stable `deviceId` | New secret ⇒ new deviceIds ⇒ `NEW_DEVICE` / MONITOR spike |
| Seller phone | `PHONE_HASH_SECRET` | HMAC → `User.phoneHash` | **Destructive** — every stored hash stops matching ⇒ all sellers lose verification and must share again. No PREVIOUS-key support. |
| Legacy Mini App | `JWT_SECRET` | HS256 paths still using legacy auth | Separate domain — **never** use as prod DEVICE_HMAC fallback |
| Auto-delivery | `PRODUCT_DELIVERY_KEY` | AES-256-GCM for delivery secrets | Old ciphertext cannot decrypt after rotate |

Refresh tokens are **opaque** (hashed in DB). Ed25519 rotation does **not** invalidate refresh cookies.

---

## 2. Ed25519 access JWT rotation

Code: [`SigningKeyService`](../../safe-deal-platform/src/auth-v2/signing-key.service.ts) — CURRENT (sign+verify), PREVIOUS (verify-only).  
**Rotate (required):** `npm run auth:rotate-ed25519 -- --render` — promotes live CURRENT → PREVIOUS and mints a new CURRENT in one printed block.  
First-time only: `npm run auth:generate-ed25519 -- --render` (does **not** set PREVIOUS).

Guard: [`ed25519-rotation-guard.ts`](../../safe-deal-platform/src/auth-v2/ed25519-rotation-guard.ts) — `--retire-previous` refuses unless `--confirm-ttl-elapsed-minutes` ≥ `ceil(AUTH_ACCESS_TTL_SECONDS/60)` (default 15).

### Steps (Amvera / Render / production)

1. Export live `AUTH_ED25519_CURRENT_*` into the shell that runs the script (so PREVIOUS promotion is correct).
2. Run `npm run auth:rotate-ed25519 -- --render` and paste **all** printed vars in **one** deploy (PREVIOUS + new CURRENT).
3. **Redeploy** the API (keys load from env at process start; in-memory cache is per process).
4. Verify:
   - Bot login / Website complete → 200, new access `kid` = CURRENT
   - `GET /api/v2/auth/me` with a still-valid pre-rotate access → OK while PREVIOUS is set and token TTL remains
5. After grace ≥ access TTL (script prints the minimum minutes), retire PREVIOUS only via:
   `npm run auth:rotate-ed25519 -- --retire-previous --confirm-ttl-elapsed-minutes=<N>`
   then remove `AUTH_ED25519_PREVIOUS_*` and redeploy.

### Do not

- Use `auth:generate-ed25519` for rotation (it skips PREVIOUS promotion)
- Clear PREVIOUS in the same deploy that swaps CURRENT
- Put private PEM in PREVIOUS (code only reads PREVIOUS public)
- Dump PEM into `AuthAuditLog` / `SecurityEvent` metadata
- Expect hot-reload without process restart on Amvera/Render
- Bypass the retire guard by hand-editing env “because it looks done”

---

## 2b. `PHONE_HASH_SECRET` — do not rotate casually

Code: [`hashPhone`](../../safe-deal-platform/src/phone-hash.ts)

- **Production:** `PHONE_HASH_SECRET` is **required**. No `JWT_SECRET` fallback — separate domain.
- There is **no** PREVIOUS-key verification path. A hash written under key A can never be
  matched under key B, so rotating is equivalent to wiping seller verification.
- Impact if rotated: every seller's `phoneHash` becomes stale, `assertSellAllowed` starts
  rejecting new listings platform-wide, and each seller must re-share their number through
  the bot. The anti-fraud `PHONE_HASH` ban markers also stop matching, weakening
  registration screening until numbers are re-collected.
- If a rotation is genuinely required (key compromise), treat it as a coordinated
  campaign: pick a low-traffic window, notify sellers in advance, and expect a support
  spike. Re-collecting numbers is the only recovery — there is no re-hash migration,
  because the plaintext is never stored.

---

## 3. `DEVICE_HMAC_SECRET` rotation

Code: [`DeviceTrustService`](../../safe-deal-platform/src/auth-v2/device-trust.service.ts)

- **Production:** `DEVICE_HMAC_SECRET` is **required**. No `JWT_SECRET` fallback.
- Changing the secret remints `deviceId` for the same browser/PWA inputs → Risk may emit `NEW_DEVICE` / raise session risk. This is expected, not automatic fraud.
- Prefer rare rotation; on **compromise**: rotate immediately, monitor Risk/SecurityEvent volume, revoke suspicious sessions via existing logout-all / session revoke APIs.

---

## 4. Legacy `JWT_SECRET` / `PRODUCT_DELIVERY_KEY`

- Rotate `JWT_SECRET` only with awareness of remaining HS256 Mini App / widget clients.
- Rotating `PRODUCT_DELIVERY_KEY` breaks decryption of existing auto-deliver payloads — plan a re-encrypt migration before rotating in production.

---

## 5. Secrets-in-logs checklist

| Rule | Status |
|------|--------|
| No `JSON.stringify(process.env)` in app code | Required |
| Errors go through `formatErrorForLog` / `redactSecrets` | Required |
| Startup inventory logs **names + present/missing only** | Slice 5 |
| Tokens / PEM / HMAC never in audit payloads | Required |

After any env change on Render: redeploy, confirm startup log `secrets_inventory` shows required keys `present`, then smoke Bot Login + refresh.

---

## 6. Related docs

- [ONIX-AUTH-ED25519-PRODUCTION-CONFIG.md](./ONIX-AUTH-ED25519-PRODUCTION-CONFIG.md) — first-time key provisioning
- [ONIX-PRIVACY-FIRST-SECURITY.md](./ONIX-PRIVACY-FIRST-SECURITY.md) — privacy principles + Slice map
