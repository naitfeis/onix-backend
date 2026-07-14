# ONIX Auth — Audit Remediation Completion Report

| Field | Value |
| --- | --- |
| **Document** | ONIX-AUTH-AUDIT-REMEDIATION |
| **Date** | 2026-07-15 |
| **Parent** | Final Backend Readiness Review |
| **Status** | Complete — **stop** (no Phase 4, `USE_NEW_AUTH` still false) |

---

## Summary

Closed the three audit findings without changing API contracts, Mini App behaviour, or enabling new auth.

| Finding | Action | Result |
| --- | --- | --- |
| M1 `previousRefreshHash` index | Migration + deploy + EXPLAIN | **Index Scan** confirmed |
| M2 `IdentityLink.deletedAt` | Phase 4 TODO + arch comment | **Runtime unchanged** |
| L1 exception logging secrets | `safe-error-log` + filter harden | **PASS** |

---

## 1. Session.previousRefreshHash index

- Schema: `@@index([previousRefreshHash])` on `Session`
- Migration: `prisma/migrations/20260715210000_session_previous_refresh_hash_idx/`
- Applied on Neon: **yes** (`prisma migrate status` → up to date)
- EXPLAIN:

```
Limit
  -> Index Scan using "Session_previousRefreshHash_idx" on "Session"
        Index Cond: (previousRefreshHash = $1)
INDEX_PRESENT= yes
```

Helper script (ops re-check): `safe-deal-platform/scripts/explain-previous-refresh-hash.ts`

---

## 2. IdentityLink.deletedAt (soft-delete)

**Runtime not changed** (login still reactivates soft-deleted TELEGRAM link via `deletedAt: null`).

Documented as **TODO(Phase 4 — soft-unlink correctness)** in `identity-link.ts` with gates:

1. Unlink API + last-factor guards  
2. `AUTH_ENFORCE_IDENTITY_LINK`  
3. Explicit RELINK vs reject product rule  

---

## 3. ApiExceptionFilter / secret-safe logging

- New: `safe-error-log.ts` → `redactSecrets` / `formatErrorForLog`
- `ApiExceptionFilter` logs only redacted text (no raw Error dump)
- Also applied to legacy `AuthService.verifyToken` catch path
- Redacts: Bearer, JWT blobs, `__Host-onix_rt` / `onix_rt`, PEM private keys, access/refresh token key=value forms

---

## Verification

| Check | Result |
| --- | --- |
| `npm test` | **75/75** pass |
| `npm run lint` | pass (`tsc --noEmit`) |
| `npm run typecheck` | pass |
| `prisma migrate status` | **Database schema is up to date** |
| EXPLAIN | **Index Scan** on `Session_previousRefreshHash_idx` |

---

## Explicit non-actions

- Phase 4 **not** started  
- `USE_NEW_AUTH` **not** enabled  
- No API / Mini App / cookie / refresh contract changes  

---

## Remaining before Website cutover (unchanged from readiness review)

Frontend AuthManager · same-origin `__Host-` · ops checklist soak · Ed25519 keys before v2 traffic · Phase 4 soft-unlink implementation
