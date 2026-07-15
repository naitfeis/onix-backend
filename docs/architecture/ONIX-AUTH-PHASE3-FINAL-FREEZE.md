# ONIX Auth — Phase 3 Final Architecture Freeze

| Field | Value |
| --- | --- |
| **Document** | ONIX-AUTH-PHASE3-FINAL-FREEZE |
| **Date** | 2026-07-15 |
| **Status** | **FROZEN** — backend Phase 3 complete; no further Phase 3 auth scope |
| **Parent** | ADD v1.4 · Runbook · Production Validation · Audit Remediation |
| **Next** | Website Cutover prep (Frontend AuthManager + ops) — **not** Phase 4 |
| **Code changes in this freeze** | **None** (documentation only) |

---

## Freeze declaration

Phase 3 backend auth work is **architecturally frozen**.

- Do **not** start Phase 4 (`AUTH_ENFORCE_IDENTITY_LINK`, soft-unlink runtime, nullable `telegramId`).
- Do **not** enable `USE_NEW_AUTH` without Website Cutover gates.
- Do **not** change Mini App / legacy response contracts.
- Auth V2 remains **additive infrastructure** behind feature flags.

Tests at freeze: **75/75** (last known suite).

---

## 1. Feature flags — all new capabilities OFF by default

| Flag | Default (unset) | Confirmed |
| --- | --- | --- |
| `USE_NEW_AUTH` | **false** | Canary new-auth never activates |
| `AUTH_ACCEPT_V2_ACCESS` | **false** | Global guard rejects EdDSA |
| `AUTH_DUAL_ISSUE_SESSION` | **false** | No Session on legacy login |
| `AUTH_NEW_AUTH_CANARY_PERCENT` | **0** | Empty canary set |
| `AUTH_ROLLOUT_OBSERVE` | **false** | No rollout path/canary log volume |

Also frozen (related, default safe):

| Flag | Default | Role |
| --- | --- | --- |
| `AUTH_DUAL_ISSUE_SET_COOKIE` | **false** | Reserved; unused by Mini App |
| `AUTH_DUAL_WRITE_IDENTITY` | **true** | Phase 1 IdentityLink dual-write (intentional) |

**Confirmation:** With the five named flags at defaults, backend behaviour equals pre–Phase-3 client experience for Mini App + legacy HS256 domain APIs. Auth V2 modules may load; they do not alter domain auth requirements.

---

## 2. Legacy compatibility — response contracts frozen

### `POST /api/auth/telegram-mini`

| Aspect | Freeze status |
| --- | --- |
| Response keys | `accessToken`, `tokenType`, `expiresIn`, `user` — **unchanged** |
| JWT | **HS256** only (`alg: HS256`) |
| New required fields | **None** |
| Set-Cookie | **None** on this path |
| Ed25519 access | **Not** returned |

### `POST /api/auth/telegram-login`

Same contract as Mini App issue path: HS256 Bearer + `user`; no cookies; no Ed25519; no mandatory new fields.

Dual-issue Session (when flag on later) is fail-open and **must not** mutate this JSON shape.

---

## 3. Public API review

### Legitimate `@Public` surfaces

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/telegram-mini` | Mini App identity verify |
| POST | `/api/auth/telegram-login` | Legacy Telegram widget |
| GET | `/api/health/live` | Liveness |
| GET | `/api/health/ready` | Readiness + DB ping |
| * | `/api/v2/auth/*` | Class `@Public` so global HS256 guard skips; **login/refresh** are open; **logout/me/sessions** use `AuthV2Guard` |

### Confirmed absent

- No `/debug`, `/internal`, `/dev`, `/test` auth endpoints
- No temporary admin bypass routes
- No unauthenticated Marketplace / Orders / Wallet / Admin

`/api/v2/auth` is **intentional additive** Website surface — not a debug leak. It is unused by Mini App at freeze.

---

## 4. Prisma review (auth hot paths)

### Indexes present (auth-critical)

| Access pattern | Coverage |
| --- | --- |
| `User.telegramId` | `@unique` |
| `User.id` | PK |
| `IdentityLink (provider, providerUserId)` | `@@unique` |
| `IdentityLink userId` | `@@index([userId, deletedAt])` |
| `Session.refreshTokenHash` | `@unique` |
| `Session.previousRefreshHash` | `@@index` (remediation M1; EXPLAIN Index Scan verified) |
| `Session (userId, revokedAt, lastSeenAt)` | `@@index` |
| `Session.familyId` | `@@index` |
| `TrustedDevice (userId, fingerprintHash)` | `@@unique` |

### N+1 / full scan notes

| Path | Assessment |
| --- | --- |
| V2 login TX (User + Link + Session + Audit) | Single TX; keyed lookups — **OK** |
| Refresh by hash | Unique / indexed — **OK** |
| Reuse via `previousRefreshHash` | Indexed — **OK** |
| Legacy Mini upsert | `findUnique(telegramId)` — **OK** |
| RBAC `userRole` include permissions | Only on AuthV2Guard; not on domain — **OK at freeze** |
| Domain list endpoints | Pre-existing product queries; **out of Phase 3 auth freeze** beyond auth tables |

No missing auth-table index known at freeze after M1 remediation.

---

## 5. Security review — secrets in logs

| Secret class | Status |
| --- | --- |
| Refresh token plaintext | **Not logged** (orchestrator logs ids/codes only; DB stores hash) |
| Access JWT | **Not logged** |
| Cookies / `__Host-onix_rt` | **Not logged** |
| Private PEM | **Not logged**; held as `KeyObject` |
| Exception paths | `formatErrorForLog` / `redactSecrets` on `ApiExceptionFilter` + legacy verify catch |

Reuse events may store **hash prefix** (8 hex) — not opaque refresh; accepted.

---

## 6. Dead / dormant inventory — list only (DO NOT DELETE)

### Dormant-by-design (required for cutover)

- Entire `/api/v2/auth` + `AuthOrchestrator` / `SessionService` / `TokenService` / `SigningKeyService`
- `DualAccessService`, `AuthRolloutService`
- Refresh cookie helpers
- `PermissionGuard` / `RolesGuard` / `RequirePermissions` / `RequireRoles` (no domain wiring yet)
- `RbacService` (used by AuthV2Guard only)

### Unused at runtime / reserved (keep)

| Item | Note |
| --- | --- |
| `isDualIssueRefreshCookieEnabled` | Flag reader; no Mini App caller |
| `shouldUseNewAuthForUser` / `resolveAuthMode` | Decision API; not wired to domain HTTP routing |
| `getRolloutSnapshot` / `logRollbackGuidance` | Ops helpers |
| `newOpaqueTokenId()` | **No production callers** |
| `AUTH_DUAL_ISSUE_SET_COOKIE` | Reserved ENV |
| `AUTH_RBAC_CACHE_MS`, session TTL ENVs | Read with defaults; used when V2 Session path runs |

### Documented TODO (Phase 4 — not freeze work)

- `identity-link.ts`: `TODO(Phase 4 — soft-unlink correctness)` — runtime still clears `deletedAt` on dual-write

---

## 7. Architecture freeze diagram

```
Telegram verify (Mini / Widget)
        │
        ▼
   Legacy AuthService
   HS256 issue  ◄── production default (flags OFF)
        │
        ├── domain APIs ← global AuthGuard (HS256)
        │
        └── [flags] dual-issue Session / dual-accept EdDSA / canary USE_NEW_AUTH
                    ▲
                    └── frozen OFF until Website Cutover gates
```

Module graph (no cycles): `AuthModule → AuthV2Module`; domain modules do **not** import AuthV2 services.

---

## 8. Readiness matrix (freeze)

| Layer | Ready? |
| --- | --- |
| ✅ Fully ready now (flags OFF) | Legacy login, Mini App, domain APIs, health, IdentityLink dual-write, rollback ENV recipe, secret-safe logs, auth indexes |
| ⚡ Ready only after feature flag(s) | EdDSA accept (`AUTH_ACCEPT_V2_ACCESS`); Session dual-issue (`AUTH_DUAL_ISSUE_SESSION`); canary new-auth (`USE_NEW_AUTH` + percent); observe logs |
| 🔜 Phase 4 | Soft-unlink correctness; `AUTH_ENFORCE_IDENTITY_LINK`; auth resolve via IdentityLink; telegramId independence |
| 🌐 After Website Cutover | Gradual canary → 100%; soak; keep legacy widget until metrics; `__Host-` in prod topology |
| 🖥 After Frontend AuthManager | Memory-only access; cookie refresh; single-flight; no web storage tokens; silent refresh without Telegram |

---

## Explicit non-goals locked by this freeze

- No Phase 4 schema/enforce work under this document  
- No enabling `USE_NEW_AUTH` in production via Phase 3 scope  
- No Mini App client changes  
- No deletion of dormant Auth V2 code  
- No further Phase 3 feature increments without a new ADR / unfreeze decision  

---

## Sign-off

| Role | Decision |
| --- | --- |
| Architecture | **Phase 3 backend FROZEN** |
| Implementation | Stop Phase 3 auth coding |
| Next gate | Website Cutover checklist + Frontend AuthManager — separate approval |

**Phase 4 must not start automatically.**
