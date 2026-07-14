# ONIX Auth — Final Backend Readiness Report (pre–USE_NEW_AUTH)

| Field | Value |
| --- | --- |
| **Document** | ONIX-AUTH-FINAL-BACKEND-READINESS |
| **Date** | 2026-07-15 |
| **Scope** | Backend audit only — no code / architecture changes |
| **Baseline** | ADD v1.4 · Phase 1–3.3 complete · 70/70 tests |
| **Phase 4** | **Not started** |

---

## Executive verdict

**Backend is production-safe with all new-auth flags OFF.**  
Legacy Mini App + HS256 path remain the live auth surface.  
**Not ready to flip `USE_NEW_AUTH=true` in production** until Frontend AuthManager + same-origin topology + ops checklist gates pass.

**Backend readiness for Phase 4 (enforce IdentityLink / telegramId independence): ~72%.**  
**Backend readiness to enable Website `USE_NEW_AUTH` canary (infra only): ~85%.**  
**Overall readiness for full Website cutover (incl. product/frontend/ops): ~55%.**

---

## 1. Feature flag defaults — CONFIRMED SAFE

| Flag | Default (unset) | Code path | Status |
| --- | --- | --- | --- |
| `USE_NEW_AUTH` | **false** | `isNewAuthEnabled()` | PASS |
| `AUTH_ACCEPT_V2_ACCESS` | **false** | `isAcceptV2AccessEnabled()` | PASS |
| `AUTH_DUAL_ISSUE_SESSION` | **false** | `isDualIssueSessionEnabled()` | PASS |
| `AUTH_NEW_AUTH_CANARY_PERCENT` | **0** | `getNewAuthCanaryPercent()` | PASS |
| `AUTH_ROLLOUT_OBSERVE` | **false** | `isRolloutObserveEnabled()` | PASS |
| `AUTH_DUAL_ISSUE_SET_COOKIE` | **false** | reserved | PASS |
| `AUTH_DUAL_WRITE_IDENTITY` | **true** | Phase 1 dual-write | PASS (intended) |

With these defaults: no EdDSA accept on global guard, no Session dual-issue, no canary new-auth, no extra rollout logs.

---

## 2. Backend boots without new auth — CONFIRMED

- `AppModule` loads `AuthModule` + `AuthV2Module` at startup; that is expected and **safe**.
- Controllers for `/api/v2/auth/*` are registered but unused by Mini App / current frontend.
- Global `AuthGuard` continues HS256 verification; EdDSA rejected while `AUTH_ACCEPT_V2_ACCESS=false`.
- No constructor in AuthV2 eagerly **requires** Ed25519 material.

---

## 3. Missing Ed25519 ENV does not break boot — CONFIRMED

`SigningKeyService.loadKeys()`:

- If `AUTH_ED25519_CURRENT_*` absent → caches **empty array**, does **not** throw.
- Throw `AUTH_MISCONFIGURED` only on **sign** (`getCurrentForSigning`) — i.e. when `/api/v2/auth/login` or Session token issue is actually invoked.

**Implication:** production can run forever without Ed25519 PEMs while flags stay off.  
**Gate before dual-issue / v2 login:** provision keys first.

---

## 4. Rollback without DB change — CONFIRMED

Scenario:

```
USE_NEW_AUTH=true  (+ optional canary %)
        ↓
USE_NEW_AUTH=false
```

| Aspect | Result |
| --- | --- |
| Schema / migrations | **No change required** |
| Session / IdentityLink rows | Remain (harmless) |
| Mini App / legacy JWT | Immediately authoritative again |
| Alternate kill switches | `AUTH_NEW_AUTH_CANARY_PERCENT=0`, `AUTH_ACCEPT_V2_ACCESS=false`, `AUTH_DUAL_ISSUE_SESSION=false` |

Documented in Runbook §2.3 and `ONIX-AUTH-P3.3-OPS-CHECKLIST.md`.

---

## 5. Circular module dependencies — CONFIRMED NONE

```
AuthModule ──imports──► AuthV2Module
     ▲                       │
     │                       │ exports Token/Session/Orchestrator/DualAccess/Rollout
AppModule imports both (AuthV2 also listed) — redundant, not cyclic
```

| Edge | Cycle? |
| --- | --- |
| AuthModule → AuthV2Module | One-way |
| AuthV2Module → AuthModule | **No** |
| Orchestrator → SessionService → TokenService → SigningKeyService | Acyclic |
| Orchestrator → AuthRolloutService (optional) | Acyclic |
| AuthGuard → DualAccess + Rollout (optional) | Acyclic |

**No Nest circular dependency between named modules/services.**

Note (non-blocking): `AppModule` imports `AuthV2Module` while `AuthModule` already imports it — duplicate import, harmless.

---

## 6. Prisma queries & indexes

### Covered well (PASS)

| Query pattern | Index / key |
| --- | --- |
| `User` by `id` | PK |
| `User` by `telegramId` | `@unique` |
| `IdentityLink` by `(provider, providerUserId)` | `@@unique` |
| `IdentityLink` by `userId` | `@@index([userId, deletedAt])` |
| `Session` by `id` | PK |
| `Session` by `refreshTokenHash` | `@unique` |
| `Session` list by `userId, revokedAt` | `@@index([userId, revokedAt, lastSeenAt])` |
| `Session` by `familyId` | `@@index([familyId])` |
| `TrustedDevice` by `userId + fingerprintHash` | `@@unique` |

### Gap (MEDIUM)

| Query | Index status |
| --- | --- |
| `Session.findFirst({ previousRefreshHash })` (reuse detection) | **No dedicated index** |

At low/medium volume acceptable; under refresh-theft / high concurrency this becomes a sequential scan risk.

**Recommendation (future, not now):** additive `@@index([previousRefreshHash])`.

### RBAC

`UserRole.findMany({ userId })` — confirm `userId` indexed on `UserRole` (schema has `@@index([userId])` on related tables per Phase 1). Acceptable for MVP admin traffic.

---

## 7. Security — tokens & secrets

| Control | Status | Notes |
| --- | --- | --- |
| Refresh plaintext not logged | **PASS** | Orchestrator logs `userId` / `sessionId` / codes only |
| Access JWT not logged | **PASS** | Same |
| Private PEM not logged | **PASS** | Never stringified; held as `KeyObject` |
| Rollout snapshot excludes secrets | **PASS** | Flags only |
| DB stores refresh **hash** only | **PASS** | SHA-256 hex |
| Reuse event stores hash **prefix** (8 hex) | **ACCEPT** | Not opaque token; low sensitivity |
| Dual-issue discards opaque refresh | **PASS** (contract) | Session row remains; refresh unusable without cookie path |

### Residual risks

| ID | Finding | Severity |
| --- | --- | --- |
| S1 | `ApiExceptionFilter` does `console.error(error)` + stack for **all** errors | **Low–Med** | Unlikely to include tokens today; avoid ever putting Bearer/PEM in Error.message |
| S2 | `IdentityLink` upsert sets `deletedAt: null` on every dual-write | **Med** (known P2 H1) | Soft-unlink can be undone by login — fix before unlink API / Phase 4 |
| S3 | Dual-issue creates Session then **discards** refresh | **Low** (ops) | Orphan sessions until cookie path; max-10 eviction contains growth |
| S4 | `/api/v2/auth/login` returns `accessToken` in JSON body | **By design** | Website only; Mini App unused |

---

## 8. Transactions — atomicity

### Website v2 login (`AuthOrchestrator.loginWithTelegram`) — PASS

Single `$transaction`:

1. User upsert (+ IdentityLink dual-write + IdentityHistory)  
2. Session create (refresh hash)  
3. AuthAudit `LOGIN_SUCCESS`  

Then **after COMMIT**: issue tokens + domain events (ADR-031). Correct.

### Legacy Mini App / telegram-login — PASS for production defaults

- User upsert + IdentityLink dual-write as today.  
- HS256 issued outside Session TX (unchanged contract).  
- Dual-issue (`AUTH_DUAL_ISSUE_SESSION`) is a **separate** Session TX, **fail-open** — intentionally **not** atomic with User upsert.

### Dual-issue atomicity note

| Path | Atomic User+Link+Session+Audit? |
| --- | --- |
| `/api/v2/auth/login` | **Yes** |
| Legacy + dual-issue flag | **No** (Session after User; fail-open) |

Acceptable while dual-issue is off / prep-only.

---

## 9. Memory — CONFIRMED NO LEAK CLASS

| Component | Behaviour | Assessment |
| --- | --- | --- |
| `SigningKeyService.cached` | KeyObjects until `clearCache()` | Intentional; bounded (≤2 keys) |
| `RbacService.cache` | Map with TTL; grows with distinct userId+pv | Bounded by active users; `clearCache()` available |
| `AuthEventPublisher.listeners` | Set; unsubscribe supported | No leak if subscribers remove |
| ENV PEM strings | Live in `process.env` for process life | Standard; prefer Vault later (ADR-023) |
| Dual-issue discarded tokens | Eligible for GC after call | No long-term store |

**No unbounded secret accumulation in application heaps beyond ENV + key cache.**

---

## 10. Findings summary

### Critical (block USE_NEW_AUTH in prod)

None in backend code with flags OFF.

**External blockers (not code bugs):**

1. Frontend AuthManager not shipped  
2. `onix.gg` + `/api` same-origin not verified for `__Host-`  
3. Neon restore drill sign-off  
4. Ed25519 keys not required yet — must be provisioned **before** enabling v2 login / dual-issue

### Medium

| ID | Issue | Recommendation |
| --- | --- | --- |
| M1 | No index on `Session.previousRefreshHash` | Additive index before heavy refresh traffic |
| M2 | Dual-write clears `IdentityLink.deletedAt` | Fix before unlink / Phase 4 |
| M3 | Dual-issue orphan Sessions | Keep flag off until cookie/Website path; or cron revoke unused |

### Low

| ID | Issue | Recommendation |
| --- | --- | --- |
| L1 | Global exception filter logs full Error objects | Redact / structured logger before high canary |
| L2 | Duplicate `AuthV2Module` import in AppModule | Cosmetic cleanup later |
| L3 | RBAC in-memory cache multi-instance inconsistency | Acceptable until horizontal scale |

---

## Readiness scores

| Question | Score | Rationale |
| --- | --- | --- |
| Safe to run production **with flags OFF** | **98%** | Legacy frozen; 70/70 tests; defaults safe |
| Backend infra ready for **canary USE_NEW_AUTH** (after ops+FE) | **85%** | Flags, dual-accept, dual-issue, canary, rollback, v2 API present |
| Ready for **Phase 4** (enforce IdentityLink, telegramId independence) | **72%** | Schema+links exist; H1 deletedAt, enforce flag, Mini App read-path, metrics gates missing |
| Ready for **full Website cutover today** | **55%** | Blocked on FE + topology + soak, not on Phase 1–3.3 backend quality |

---

## Explicit confirmations (checklist)

1. Feature defaults safe — **YES**  
2. Boots without new auth — **YES**  
3. Missing Ed25519 does not break boot — **YES**  
4. Rollback ENV-only, no DB migration — **YES**  
5. No circular AuthModule/AuthV2/Session/Orchestrator/Token deps — **YES**  
6. Prisma hot paths indexed — **YES**, with **M1** gap on `previousRefreshHash`  
7. Tokens/PEM not logged — **YES**, with filter hygiene **L1**  
8. V2 login TX atomic User→Link→Session→Audit — **YES**; dual-issue separate by design  
9. No secret memory leaks of concern — **YES**  
10. This report — **delivered**

---

## Do not proceed

- Do **not** enable `USE_NEW_AUTH` without `ONIX-AUTH-P3.3-OPS-CHECKLIST` sign-off.  
- Do **not** start Phase 4 without product approval.  
- No code changes were made in this audit.
