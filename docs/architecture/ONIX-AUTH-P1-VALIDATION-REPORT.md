# ONIX Auth — Phase 1 Validation Report

| Field | Value |
| --- | --- |
| **Document** | ONIX-AUTH-P1-GATE |
| **Version** | 1.0 |
| **Date** | 2026-07-14 |
| **Baseline** | ADD v1.4 · Phase Runbook v1.1 |
| **Scope** | Review only — no new functionality |
| **Reviewer** | Architecture Gate (automated + manual code review) |

---

## 1. Executive Verdict

| Gate | Result |
| --- | --- |
| Critical findings | **0** |
| High findings | **4** (tracked; non-blocking for starting Phase 2 **code**) |
| Medium / Low | See §5 |
| Mini App contract | **PASS** (hash/JWT path unchanged; tests green) |
| Phase 1 scope creep | **PASS** (no Frontend / cookies / Session API) |
| Prisma validate + unit/contract tests | **PASS** (15/15) |
| Production DoD (Neon migrate applied) | **NOT VERIFIED** in this review |

### Official conclusion

# Phase 1 accepted. Ready for Phase 2 implementation.

**Binding conditions (not Critical, but mandatory before Phase 2 staging deploy):**

1. Apply migration `20260714190000_auth_phase1_identity_platform` on Neon staging (snapshot first) and verify IdentityLink counts.  
2. Address or explicitly waive High findings H1–H4 in Phase 2 kickoff notes.  
3. Keep `USE_NEW_AUTH=false` until Phase 3.

---

## 2. Checklist vs ADD v1.4 / Runbook

| Criterion | Status | Notes |
| --- | --- | --- |
| Additive schema only; `telegramId` retained | **PASS** | Still `BigInt @unique` required |
| `sessionVersion` / `permissionVersion` on User | **PASS** | Defaults 0 |
| `IdentityLink` sole external binding model (+ soft delete) | **PASS** | `deletedAt` present |
| Unified `Session` table (device + refresh hash) | **PASS** | Table only; unused by API |
| AuthAuditLog / IdentityHistory / SecurityEvent | **PASS** | Tables present |
| RBAC / TrustedDevice / MFA stubs / SigningKey / Merge / Idempotency | **PASS** | Additive |
| Migration non-destructive | **PASS** | No drops of business tables |
| SQL backfill TELEGRAM links idempotent | **PASS** | `ON CONFLICT DO NOTHING` |
| Dual-write from Mini/legacy upsert | **PASS** | `identity-link.ts` + `auth.module` |
| Feature flag `AUTH_DUAL_WRITE_IDENTITY` | **PASS** | Default on; false skips writes |
| `USE_NEW_AUTH` not enabled | **PASS** | Not introduced in runtime |
| Mini App hash / endpoints unchanged | **PASS** | `/telegram-mini` intact |
| No Frontend / AuthManager / cookies / refresh API | **PASS** | Scope clean |
| P1-T01…P1-T12 complete in CI | **PARTIAL FAIL** | See §4 |
| Neon snapshot + migrate deploy | **FAIL (ops)** | Not evidenced in repo review |
| Backfill count gate documented in prod | **FAIL (ops)** | Pending migrate |

---

## 3. Review Axes

### 3.1 Architecture

**PASS** against Phase 1 intent: IdentityLink introduced as dual-written projection; User remains Telegram-keyed for Mini App; session/auth APIs deferred.

Gaps (non-Critical): create-user dual-write does not emit `IdentityHistory` LINKED (history only from SQL backfill). Login TX for **existing** users updates User then IdentityLink outside one transaction (ADR-031 full login TX is Phase 2).

### 3.2 Schema

**PASS** alignment with ADD v1.4 Phase 1 list. Indexes on IdentityLink `(provider, providerUserId)`, Session refresh hash, audit/time indexes present.

Notes:

- `AccountMergeRequest` / `IdempotencyRecord` / `AuthAuditLog` lack FKs to `User` (acceptable for stubs/immutable audit; document intentionally).  
- `User.mergedIntoUserId` has no self-FK (Low).

### 3.3 Migration

**PASS** as additive Prisma migration SQL. Enums + tables + backfill in one revision.

Notes:

- `CREATE TYPE` is not re-entrant (normal for Prisma).  
- `ADD COLUMN IF NOT EXISTS` differs from strict Prisma style (Low drift risk if manual DDL applied).  
- Migration **not proven** against empty/live Neon in CI (High ops gap).

### 3.4 SQL Backfill

**PASS** logic: md5 stable id matches TS `stableTelegramIdentityLinkId`; conflict-safe; IdentityHistory backfill guarded by `NOT EXISTS`.

Notes:

- History insert only for TELEGRAM links missing LINKED row — good.  
- Does not filter `deletedAt` users — still creates links for banned users (Medium; may be desired for forensics).

### 3.5 Security

| Topic | Verdict |
| --- | --- |
| Mini App crypto unchanged | **PASS** |
| No secrets in schema/migration | **PASS** |
| Refresh tokens not stored plaintext (N/A Phase 1) | **PASS** |
| Dual-write `deletedAt: null` on every login | **HIGH** — can revive soft-deleted IdentityLink (H1) |
| Dual-write `userId` overwrite on upsert | **LOW** risk given `User.telegramId` unique |
| Flag rollback stops writes | **PASS** |

### 3.6 Performance

**PASS** for current scale.  

Notes: TS backfill script is N+1 (findUnique + upsert per user) — fine for ops re-run; prefer SQL migration for large prod (already primary path). Extra IdentityLink upsert per login — acceptable Phase 1 cost.

### 3.7 Code Review

**PASS** with nits:

- Dual-write helper cleanly separated; Mini App path preserved.  
- Existing-user path: User update succeeds even if IdentityLink upsert fails → eventual inconsistency until retry (H2).  
- New-user path: IdentityLink inside `$transaction` — **good**.  
- `newOpaqueTokenId` unused dead export (Low).  
- No active-link query helper (`deletedAt IS NULL`) — P1-T09 missing (H3/M).

---

## 4. Test Matrix (Runbook §3.1)

| ID | Result | Evidence |
| --- | --- | --- |
| P1-T01 Migration empty DB | **FAIL** | No automated DB integration test |
| P1-T02 Migration with Users | **FAIL** | No automated DB integration test |
| P1-T03 Backfill one link/user | **PARTIAL** | Unit mock backfill; SQL in migration untested in CI |
| P1-T04 Backfill idempotent | **PASS** | Unit + SQL `ON CONFLICT` |
| P1-T05 Unique provider+id | **PARTIAL** | Schema/SQL unique; no DB constraint test |
| P1-T06 Dual-write on Mini upsert | **PASS** | Mini App tests assert IdentityLink row |
| P1-T07 Dual-write updates lastUsedAt | **PARTIAL** | Upsert update sets `lastSeen`-equiv `lastUsedAt`; no dedicated assert |
| P1-T08 Concurrent no duplicate Users | **PASS** | Existing P2002 retry test + dual-write |
| P1-T09 Soft-delete active helper | **FAIL** | Helper + test absent |
| P1-T10 Mini contract unchanged | **PASS** | Existing Mini tests green |
| P1-T11 sessionVersion/permissionVersion default | **PARTIAL** | Schema default only; no unit assert |
| P1-T12 Flag off skips writes | **PASS** | Explicit test |

**Summary:** 4 PASS · 4 PARTIAL · 4 FAIL (mostly missing DB/integration coverage, not product regressions).

---

## 5. Findings Register

| ID | Severity | Area | Finding | Recommendation |
| --- | --- | --- | --- | --- |
| **H1** | **High** | Security | `dualWriteTelegramIdentity` update sets `deletedAt: null`, silently re-activating soft-deleted links on every Mini login | Do not clear `deletedAt` on dual-write; if row soft-deleted, skip update or write SecurityEvent / refuse (Phase 2 identity policy) |
| **H2** | **High** | Consistency | Existing-user dual-write is outside the User update transaction | Wrap `user.update` + `identityLink.upsert` in one `$transaction` |
| **H3** | **High** | Test/DoD | P1-T01/T02 (and soft-delete helper T09) not in CI; Runbook DoD incomplete | Add staging migrate smoke + `deletedAt IS NULL` helper before/at Phase 2 start |
| **H4** | **High** | Ops | Neon snapshot / migrate deploy / count verification not evidenced | Execute Runbook §1 before any Phase 2 staging API deploy |
| M1 | Medium | Audit | New User dual-write does not insert `IdentityHistory LINKED` | Write history when creating a new IdentityLink (or accept backfill-only for Phase 1) |
| M2 | Medium | SQL | Backfill creates links for `User.deletedAt IS NOT NULL` | Optionally exclude banned users or mark links soft-deleted |
| M3 | Medium | Schema | `AccountMergeRequest` without FK to User | Add FKs when merge flow is implemented |
| M4 | Medium | Test | P1-T07/T11 weak coverage | Add asserts in Phase 2 test pack |
| L1 | Low | Code | Unused `newOpaqueTokenId` | Remove or use in Phase 2 TokenService |
| L2 | Low | Migration | `IF NOT EXISTS` on columns vs Prisma purity | Leave as-is; document |
| L3 | Low | Schema | `mergedIntoUserId` without self-relation | Optional FK later |

**Critical: none.**

---

## 6. Scope Compliance (Forbidden in Phase 1)

| Forbidden item | Present? |
| --- | --- |
| Frontend AuthManager | No |
| Cookie / `__Host-` | No |
| Refresh / Session HTTP API | No |
| `/api/v2/auth` | No |
| Google / Email / Passkey adapters | No |
| Mini App hash changes | No |

**PASS.**

---

## 7. Residual Risk After Acceptance

1. Production DB may not yet have Phase 1 tables — Phase 2 code must not assume prod migrated until H4 closed.  
2. Soft-delete revive (H1) becomes material once unlink exists — fix before Identity unlink API.  
3. Incomplete automated migration tests — rely on staging migrate as gate.

---

## 8. Sign-off

| Role | Decision |
| --- | --- |
| Architecture Gate | **Phase 1 accepted** (0 Critical) |
| Phase 2 code start | **Authorized** |
| Phase 2 staging deploy | **Blocked** until H4 (Neon) + recommend H1/H2 |

---

**Phase 1 accepted. Ready for Phase 2 implementation.**
