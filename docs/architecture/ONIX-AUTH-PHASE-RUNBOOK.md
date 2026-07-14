# ONIX Auth — Phase Implementation Runbook

| Field | Value |
| --- | --- |
| **Document** | ONIX-AUTH-PHASE-RUNBOOK |
| **Version** | 1.1 |
| **Date** | 2026-07-14 |
| **Parent** | ONIX-AUTH-ADD v1.4 (+ ADRs 037–044) |
| **Status** | Phase 1 **implemented in repo** — apply migration on Neon per §1 |

---

## 0. Can we start?

**Yes — Phase 1 only.**

| Allowed in Phase 1 | Forbidden in Phase 1 |
| --- | --- |
| Prisma schema (additive) | Frontend / AuthManager |
| Migration | Cookies / `__Host-` |
| IdentityLink + Session + Audit (+ additive auth tables per ADD) | Refresh / Session HTTP API |
| Backfill | Website cutover |
| Dual-write from existing auth upsert | Changing Mini App hash verification |
| Automated tests for schema/backfill/dual-write | Google / Email / Passkey |

Later phases:

```
Phase 1  Schema → Migration → Backfill → Dual-write → Tests
Phase 2  Session API (/api/v2/auth)
Phase 3  Website Auth (USE_NEW_AUTH canary)
Phase 4  telegramId independence / enforce IdentityLink
Phase 5  Email → Google → Passkey (roadmap)
```

---

## 1. Migration Runbook (Phase 1)

### 1.1 Pre-flight

1. Confirm ADD v1.4 accepted.  
2. Take **Neon branch / snapshot** labeled `pre-auth-phase1-YYYYMMDD`.  
3. Note current User count: `SELECT COUNT(*) FROM "User";`  
4. Confirm `BOT_TOKEN` / Mini App e2e still green on staging.  
5. Feature flags defaults: `AUTH_DUAL_WRITE_IDENTITY=true`, `USE_NEW_AUTH=false`.

### 1.2 Schema (additive — order)

Apply in one Prisma migration (or sequenced migrations if preferred):

1. `User.sessionVersion Int @default(0)`  
2. `User.permissionVersion Int @default(0)`  
3. `User.securityScore` / `securityScoreAt` (optional nullable)  
4. Enums: `AuthProvider`, `AuthAuditAction`, `SecurityEventType`, …  
5. `IdentityLink` (+ soft `deletedAt`)  
6. `Session` (unified device + refresh hash fields; unused by API yet)  
7. `AuthAuditLog`, `IdentityHistory`, `SecurityEvent`  
8. RBAC: `Role`, `Permission`, `RolePermission`, `UserRole`  
9. `TrustedDevice`, MFA stubs (`MfaFactor`, `MfaChallenge`)  
10. `SigningKey` metadata table (public key + kid; private via SecretsProvider)  
11. Optional stub: `AccountMergeRequest`  

**Do not drop or null `telegramId` in Phase 1.**

### 1.3 Expand migration steps (production)

```
1. neon snapshot
2. prisma migrate deploy (staging first)
3. smoke: SELECT from new tables
4. backfill job (below)
5. enable dual-write in app (if not already in same deploy)
6. verify counts
7. Mini App login e2e
8. prisma migrate deploy (production)
9. backfill production
10. verify + hold 24h
```

### 1.4 Backfill IdentityLink

Idempotent SQL/job:

```text
For each User where telegramId IS NOT NULL:
  INSERT IdentityLink (userId, TELEGRAM, providerUserId=telegramId::text, …)
  ON CONFLICT (provider, providerUserId) DO NOTHING
```

Acceptance:

```text
COUNT(User with telegramId) == COUNT(active IdentityLink TELEGRAM)
  (+ explain any deletedAt users)
```

Re-runnable: yes (ADR-032).

### 1.5 Dual-write

In existing Mini App + legacy telegram-login upsert path (minimal change):

- After User create/update, upsert `IdentityLink` for TELEGRAM.  
- No change to hash verification, JWT issue shape, or Mini App client.  
- Behind `AUTH_DUAL_WRITE_IDENTITY` (default true).

### 1.6 Post-checks

| Check | Pass criteria |
| --- | --- |
| Migration applied | `_prisma_migrations` ok |
| Backfill | Counts match |
| Dual-write | New Mini login creates/updates IdentityLink |
| Mini App | Existing contract tests green |
| Website legacy | Still works (USE_NEW_AUTH=false) |
| No cookies/v2 | No new auth routes required |

---

## 2. Rollback Plan

### 2.1 Phase 1 rollback

| Severity | Action |
| --- | --- |
| Dual-write bug | Set `AUTH_DUAL_WRITE_IDENTITY=false`; fix; re-enable |
| Bad backfill data | Truncate/fix IdentityLink rows; re-run backfill (Users untouched) |
| Migration failure mid-way | Neon PITR / restore `pre-auth-phase1-*` branch; fix migration; retry |
| Need to remove tables | Prisma down migration **only if** no prod dependence; prefer leave additive empty tables |

**Never** rollback by deleting Users or business rows.

### 2.2 Phase 2 rollback

- Disable `/api/v2/auth` routes or return 404 via flag.  
- Mini App + legacy `/telegram-login` unchanged.  
- Sessions rows may remain; harmless.

### 2.3 Phase 3 rollback (Website cutover) — critical

```
USE_NEW_AUTH = false
```

Website resumes legacy Telegram widget → `/api/auth/telegram-login` → JWT in prior storage **only if** legacy path still deployed.

Requirements to keep rollback possible:

1. Do not delete `/api/auth/telegram-login` until Phase 4 sunset metrics.  
2. Do not remove sessionStorage legacy client code until flag stable > soak period (e.g. 14 days).  
3. Keep HS256 Mini/legacy verify working.

If cookies already issued: clearing `__Host-onix_rt` on logout path optional; users simply re-login via legacy.

### 2.4 Phase 4+ rollback

- Column drops (`telegramId`) are **forward-only** after gate.  
- If enforce-IdentityLink breaks Mini: set `AUTH_ENFORCE_IDENTITY_LINK=false` (read telegramId fallback).

### 2.5 Neon restore drill (before Phase 3)

1. Create branch from PITR timestamp.  
2. Point staging DATABASE_URL at branch.  
3. Run Mini App auth e2e + backfill verify.  
4. Record actual RTO.  
5. Target: **RPO ≤ 5 min**, **RTO ≤ 1 h** (ADR-034).

---

## 3. Integration / Automated Test List

### 3.1 Phase 1 (required before Phase 1 Done)

| ID | Test | Type |
| --- | --- | --- |
| P1-T01 | Migration applies on empty DB | Integration |
| P1-T02 | Migration applies on DB with existing Users | Integration |
| P1-T03 | Backfill creates one TELEGRAM IdentityLink per User | Integration |
| P1-T04 | Backfill is idempotent (second run no duplicates) | Integration |
| P1-T05 | Unique `(provider, providerUserId)` enforced | Integration |
| P1-T06 | Dual-write on Mini upsert creates IdentityLink | Integration |
| P1-T07 | Dual-write on existing User updates `lastUsedAt` / profile cache fields only as designed | Integration |
| P1-T08 | Concurrent dual-write does not create duplicate Users (telegramId unique + P2002 retry) | Integration |
| P1-T09 | Soft-deleted IdentityLink does not count as active in queries helper | Unit |
| P1-T10 | Mini App hash verify + JWT issue **unchanged** (existing tests still pass) | Contract |
| P1-T11 | `sessionVersion` / `permissionVersion` default 0 on new User | Unit |
| P1-T12 | Rollback flag off stops IdentityLink writes | Integration |

### 3.2 Phase 2 (preview — not Phase 1)

| ID | Focus |
| --- | --- |
| P2-T01 | Login callback TX: User+Link+Session+Audit atomic |
| P2-T02 | Events not emitted on TX rollback |
| P2-T03 | Refresh CAS winner/loser (parallel tabs) |
| P2-T04 | Refresh reuse → family revoke + AUTH_REFRESH_REUSED |
| P2-T05 | Access Ed25519 verify + kid + skew ±30s |
| P2-T06 | sessionVersion bump invalidates access |
| P2-T07 | Session max 10 evicts oldest |
| P2-T08 | Error codes contract snapshot |
| P2-T09 | CSRF on refresh/logout |
| P2-T10 | Rate limit keys |

### 3.3 Phase 3 preview

| ID | Focus |
| --- | --- |
| P3-T01 | USE_NEW_AUTH false → legacy path |
| P3-T02 | USE_NEW_AUTH true → memory access + cookie refresh |
| P3-T03 | No Telegram calls on silent refresh |
| P3-T04 | Canary % / rollback flag |

---

## 4. Definition of Done (per phase)

### Phase 1 — DoD

- [ ] Additive migration merged and applied on staging + production  
- [ ] Neon `pre-auth-phase1-*` snapshot exists  
- [ ] Backfill complete; count check documented  
- [ ] Dual-write live; `AUTH_DUAL_WRITE_IDENTITY=true`  
- [ ] P1-T01…P1-T12 green in CI  
- [ ] Existing Mini App auth tests green (no hash logic change)  
- [ ] `USE_NEW_AUTH` remains **false**  
- [ ] No Frontend AuthManager / cookie / refresh shipped  
- [ ] Runbook §1 post-checks signed off  

### Phase 2 — DoD

- [ ] `/api/v2/auth/*` implemented behind flag / not used by Website yet  
- [ ] Ed25519 keys via SecretsProvider; kid rotation supports CURRENT+PREVIOUS  
- [ ] Login TX + post-commit events (ADR-031)  
- [ ] Refresh CAS + reuse detection  
- [ ] AUTH_* error contract  
- [ ] Observability: requestId + basic metrics  
- [ ] P2 tests green; Mini App untouched  

### Phase 3 — DoD

- [ ] `onix.gg` + `/api` same-origin verified for `__Host-`  
- [ ] AuthManager memory-only access; no token in web storage  
- [ ] Canary `USE_NEW_AUTH` with rollback rehearsed  
- [ ] Neon restore drill done (ADR-034)  
- [ ] Silent refresh without Telegram proven  
- [ ] Soak period without elevating error budget  

### Phase 4 — DoD

- [ ] Auth reads IdentityLink first  
- [ ] `telegramId` nullable or unused by auth  
- [ ] Metrics: zero reliance on telegramId for auth resolve  

### Phase 5 — DoD

- [ ] Email Magic Link live (recovery root)  
- [ ] Google adapter without User schema change  
- [ ] Passkey adapter scheduled/shipped per roadmap  
- [ ] Unlink Telegram with Email retained works end-to-end  

---

## 5. Transaction & Idempotency cheat-sheet (implementers)

**Login success TX:** User + IdentityLink + Session + AuthAudit (+ IdentityHistory if new link) → COMMIT → events.

**Idempotent callback:** same Telegram id ⇒ same User; may create **new** Session (new device login) — that is intentional, not a duplicate User bug.

**Idempotent refresh:** same refresh hash processed twice concurrently ⇒ one CAS wins; client single-flight; do not revoke family on “already rotated to what we just set”.

**Clock skew:** ±30 seconds on exp/iat/nbf.

---

## 6. Sign-off

| Role | Phase 1 start | Date |
| --- | --- | --- |
| Architecture | Go for Phase 1 only | 2026-07-14 |
| Implementer | ☐ Begin schema PR | |
| Reviewer | ☐ Migration + tests | |

**Next action:** apply `20260714190000_auth_phase1_identity_platform` on staging Neon (snapshot first), verify backfill counts, then production. Phase 2 only after Phase 1 DoD.

### Phase 1 delivered in repository

| Artifact | Path |
| --- | --- |
| Schema | `prisma/schema.prisma` (IdentityLink, Session, audits, RBAC, …) |
| Migration + SQL backfill | `prisma/migrations/20260714190000_auth_phase1_identity_platform/` |
| Dual-write | `safe-deal-platform/src/identity-link.ts` + `auth.module.ts` |
| Re-run backfill script | `npm run auth:backfill-identity` |
| Tests | P1 dual-write/backfill/flag + existing Mini App contract |
