# ONIX Privacy-first Fintech Security

Status: **Slice 1** — Session & Device Trust (with signal/HMAC corrections)  
Principles apply to all later slices (Risk, Step-up, Financial Controls, Admin plane).  
**Do not start Slice 2 until explicitly commanded.**

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

## Stack (target)

```text
ONIX Identity → Session & Device Trust → Security Events
  → Risk Engine → Step-up Auth → Financial Controls → Audit Trail
```

| Slice | Scope |
|-------|--------|
| **1** | Device HMAC (stable-ish only), strip invasive fingerprints, TTL defaults, IP retention |
| 2 | Risk on withdraw / new device+IP (uses context signals separately) — **wait for command** |
| 3 | Step-up (Telegram confirm / MFA) |
| 4 | Ledger actor/source/correlationId + velocity |
| 5 | KMS / key rotation hygiene |
| 6 | Separate Admin Control Plane |

## Explicit non-goals

- Eternal cookies without server-side revoke
- “Collect everything so the user can never leave”
- Phone scraping
- Storing tokens in audit payloads
- Binding production device HMAC to `JWT_SECRET`
