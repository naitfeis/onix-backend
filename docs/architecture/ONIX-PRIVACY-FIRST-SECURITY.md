# ONIX Privacy-first Fintech Security

Status: **Slice 2** — Security Events + Risk Engine (withdraw / new device+IP)  
Principles apply to all later slices (Step-up, Financial Controls, Admin plane).

## Principles

1. **Purpose limitation** — collect only signals needed for a named security function.
2. **Minimization** — no canvas/WebGL fingerprinting; no hidden phone harvesting.
3. **Retention** — raw IP and coarse network signals are time-bounded; events may outlive IPs.
4. **Revocation** — long sessions are allowed; stolen refresh must be revocable (family revoke).
5. **No secrets in audit** — never store access/refresh tokens or signing keys in logs.

## Identity

| Signal | Use | Notes |
|--------|-----|--------|
| `telegramUserId` | Primary identity | Via Telegram Login / Mini App |
| Display / nick user opted in | UX | Not used as security sole factor |
| Phone | **Not collected** | Telegram may omit; do not scrape |

## Device trust (Slice 1)

### Conceptual IDs (inputs only — never user primary keys)

| Field | Meaning |
|-------|---------|
| `browserId` | Identifier of **browser storage** (localStorage UUID) |
| `pwaInstallId` | Identifier of **this PWA installation** (localStorage UUID) |

They are only inputs to the HMAC. They are **not** the user id and must not be treated as account identity.

### Signal split

```text
Stable-ish (enter deviceId HMAC):
├── browserFamily
├── osFamily
├── browserId
└── pwaInstallId

Context (session / Risk Engine — NOT in deviceId):
├── timezone
└── locale
```

```text
canonicalize(stable-ish)
    ↓
HMAC-SHA256(DEVICE_HMAC_SECRET, …)
    ↓
deviceId
```

Changing browser language (`en-US` → `ru-RU`) or timezone must **not** mint a new `deviceId`.

**Not accepted / not stored on new writes:**

- `canvasHash`, `webglHash`
- client-supplied `fingerprintHash` (server derives `deviceId` instead)

Stored as `Session.fingerprintHash` / `TrustedDevice.fingerprintHash` for schema compatibility (value = server `deviceId`). Session still keeps `timezone` / `language` as context fields.

### Secret policy

| Env | Rule |
|-----|------|
| **Production** | `DEVICE_HMAC_SECRET` **required** — startup/HMAC throws if missing. **No** `JWT_SECRET` fallback (separate security domains). |
| **Development** | `DEVICE_HMAC_SECRET` preferred; else `JWT_SECRET`; else fixed local-only string. |

## Session TTLs (target)

| Token / session | Default | Env |
|-----------------|---------|-----|
| Access JWT | 15 minutes | `AUTH_ACCESS_TTL_SECONDS` (900) |
| Refresh idle | 14 days | `AUTH_SESSION_IDLE_MS` |
| Refresh idle (remember) | **180 days** | `AUTH_SESSION_REMEMBER_IDLE_MS` |
| Absolute session max | **365 days** | `AUTH_SESSION_ABSOLUTE_MS` |

User can list sessions, revoke one, or logout-all (existing Auth v2 APIs).

## IP retention (Slice 1)

| Store | Action after retention |
|-------|------------------------|
| `SecurityEvent.ipAddress` | set `null` |
| `AuthAuditLog.ipAddress` | set `null` |

Default: `SECURITY_IP_RETENTION_DAYS=120` (90–180 day band).  
Worker job: `security-ip-retention`.

Aggregated risk / AbuseMarker hashes may live longer (no raw IP required).

### Client IP resolution (Bot Login / Auth)

Bot Login and Auth v2 resolve IP server-side via `resolveClientIp` (`src/http/client-ip.ts`):

1. `CF-Connecting-IP` (Cloudflare)
2. `True-Client-IP` / `X-Real-IP`
3. first public hop in `X-Forwarded-For`
4. Express `req.ip` (requires `trust proxy`)

Nest sets `trust proxy = 1` by default (`TRUST_PROXY` env override). Client-supplied `device.ipAddress` is ignored. Local `::1` in Telegram prompts is labeled `(локально)` — expected on localhost only.

## Risk Engine (Slice 2)

Separate from registration `RiskScoreService` (AbuseMarker multi-factor).

```text
RiskEngine.evaluate*(context) → RiskDecision
  action: ALLOW | MONITOR | STEP_UP | BLOCK
```

Auth / wallet **own** mutations; the engine only scores and emits `SecurityEvent` drafts.

### Factors (weights)

| Factor | Weight | Notes |
|--------|--------|--------|
| `NEW_DEVICE` | 40 | deviceId not in prior sessions / not TrustedDevice |
| `NEW_IP` | 25 | IP not seen on prior sessions |
| `NEW_COUNTRY` | 20 | country hop |
| `LARGE_AMOUNT` | 30 | ≥ `RISK_WITHDRAW_LARGE_CENTS` (default 5_000_000 = 50_000 ₽) |
| `NEW_PAYOUT_DEST` | 25 | new destination vs prior withdraw audits |
| `HIGH_SESSION_RISK` | 15 | session.riskScore ≥ 40 |
| `CONTEXT_SHIFT` | 5 | timezone/locale change — **never sole STEP_UP** |

Thresholds: MONITOR ≥ `RISK_MONITOR_SCORE` (25), STEP_UP ≥ `RISK_STEP_UP_SCORE` (50).

### Login

- New device / IP / country → **MONITOR** only (`SESSION_ANOMALY` / `IMPOSSIBLE_TRAVEL`), raise `Session.riskScore`.
- No auto logout / no STEP_UP on login in Slice 2 (ADR-021).

### Withdraw (`POST /wallet/withdrawals` + AI withdraw)

- Evaluate factors → write `SecurityEvent` on MONITOR / STEP_UP.
- **STEP_UP** → create `MfaChallenge` (TELEGRAM), notify bot, return `AUTH_STEP_UP_REQUIRED` with `challengeId` + deep links.
- Client confirms in Telegram (`confirm_mfa:` / `/start mfa_<id>`), polls `GET /api/v2/auth/mfa/status`, retries withdraw with `stepUpChallengeId`.
- Soft rollout: `RISK_STEP_UP_ENFORCE=false` demotes STEP_UP → MONITOR.

| Env | Default | Meaning |
|-----|---------|---------|
| `RISK_WITHDRAW_LARGE_CENTS` | `5000000` | Large withdrawal threshold |
| `RISK_MONITOR_SCORE` | `25` | MONITOR floor |
| `RISK_STEP_UP_SCORE` | `50` | STEP_UP floor |
| `RISK_STEP_UP_ENFORCE` | `true` | Enforce step-up |
| `MFA_CHALLENGE_TTL_MS` | `600000` | Telegram MFA challenge TTL (1–60 min) |

## Stack (target)

```text
ONIX Identity → Session & Device Trust → Security Events
  → Risk Engine → Step-up Auth → Financial Controls → Audit Trail
```

| Slice | Scope |
|-------|--------|
| 1 | Device HMAC (stable-ish only), strip invasive fingerprints, TTL defaults, IP retention |
| 2 | Risk Engine on withdraw / new device+IP; MONITOR on login; STEP_UP stub |
| **3** | Telegram MFA step-up (`MfaChallenge` + bot confirm + FE poll/retry) |
| 4 | Ledger actor/source/correlationId + velocity |
| 5 | KMS / key rotation hygiene |
| 6 | Separate Admin Control Plane |

## Explicit non-goals

- Eternal cookies without server-side revoke
- “Collect everything so the user can never leave”
- Phone scraping
- Storing tokens in audit payloads
- Binding production device HMAC to `JWT_SECRET`
- TOTP / Passkey / Email MFA factors (schema ready; runtime = Telegram only in Slice 3)
