# ONIX Auth — Backend Production Validation Report

| Field | Value |
| --- | --- |
| **Document** | ONIX-AUTH-BACKEND-PRODUCTION-VALIDATION |
| **Date** | 2026-07-15 |
| **Scope** | Full backend audit vs Auth V2 (read-only) |
| **Baseline** | ADD v1.4 · Phase 1–3.3 · Audit remediation · 75/75 tests |
| **Phase 4** | **Not started** |
| **USE_NEW_AUTH** | **Must remain false** |

---

## Executive verdict

**Backend is production-safe for continued Legacy / Mini App operation with all new-auth flags at defaults.**

Auth V2 is **additive and dormant**: registered endpoints exist under `/api/v2/auth`, but no Marketplace / Orders / Wallet / … route requires Ed25519, Session, or `USE_NEW_AUTH`.

| Score | Meaning |
| --- | --- |
| **Backend readiness (Legacy prod, flags OFF)** | **96%** |
| **Backend readiness for Website `USE_NEW_AUTH` canary** | **82%** (blocked on FE + topology + keys + soak) |
| **Backend readiness for Phase 4** | **70%** (soft-unlink TODO, enforce IdentityLink, Mini App read-path) |

---

## 1. Legacy endpoints still work — PASS

| Surface | Path | Auth |
| --- | --- | --- |
| Mini App login | `POST /api/auth/telegram-mini` | `@Public` + HS256 issue |
| Website widget (legacy) | `POST /api/auth/telegram-login` | `@Public` + HS256 issue |
| Products | `/api/products/*` | Global `AuthGuard` → HS256 |
| Orders / Escrow | `/api/orders/*` | Global `AuthGuard` → HS256 |
| Wallet | `/api/wallet/*`, `/api/wallet/ledger` | Global `AuthGuard` → HS256 |
| Favorites / social | `/api/favorites/*`, follow/block | Global `AuthGuard` → HS256 |
| Chats / notifications | `/api/chats/*`, `/api/notifications/*` | Global `AuthGuard` → HS256 |
| Reviews | `POST /api/orders/:id/reviews`, `GET /api/users/:onixId/reviews` | Global `AuthGuard` → HS256 |
| Profiles | `/api/users/me`, `/api/users/:onixId` | Global `AuthGuard` → HS256 |
| Admin | `/api/admin/*` | Global `AuthGuard` + `AdminGuard` (`isAdmin`) |
| Health | `/api/health/live`, `/ready` | `@Public` |

No legacy controller imports `AuthV2Guard`, `TokenService`, or `SessionService`.

---

## 2. Mini App compatibility — PASS

- InitData verify + HS256 JWT issue **unchanged** (`AuthService.miniApp`).
- Response contract: `accessToken`, `tokenType`, `expiresIn`, `user` — **unchanged**.
- Dual-issue Session only if `AUTH_DUAL_ISSUE_SESSION=true` (default **false**); fail-open; response still HS256-only.
- Mini App clients continue to call protected APIs with legacy Bearer HS256 → global `AuthGuard.verifyToken`.

---

## 3. No endpoint accidentally requires new auth — PASS

| Mechanism | Behaviour at defaults |
| --- | --- |
| Global `APP_GUARD` = legacy `AuthGuard` | HS256 only; EdDSA **rejected** (`AUTH_ACCEPT_V2_ACCESS=false`) |
| `/api/v2/auth/*` | Class-level `@Public()` → global guard skipped; protected sub-routes use `AuthV2Guard` **only there** |
| Domain modules | No `@UseGuards(AuthV2Guard)` |

**Conclusion:** Enabling nothing new is required to call Marketplace/Orders/etc. Sending an Ed25519 token to those routes fails closed (401) until accept-v2 flag is on — correct.

---

## 4. Correct AuthGuard usage — PASS

```
AppModule → APP_GUARD: AuthGuard (legacy dual-capable)
AuthV2Controller → @Public + AuthV2Guard on logout/me/sessions
AdminController → AuthGuard (global) + AdminGuard (isAdmin)
All other domain controllers → AuthGuard (global) only
```

`CurrentUser` always reads `AuthUser` from legacy guard shape (`id`, `telegramId`, `onixId`, `isAdmin`).

---

## 5. RBAC unchanged — PASS

| Layer | Status |
| --- | --- |
| Admin authorization | Still `user.isAdmin` + `AdminGuard` |
| Profile DTO roles | `response.ts`: `isAdmin ? ['USER','ADMIN'] : ['USER']` |
| Auth V2 `RbacService` / `PermissionGuard` / `RolesGuard` | Present, **not applied** to domain routes |
| `RequirePermissions` / `RequireRoles` | **Unused on any production controller** |

Legacy admin model is intact. New RBAC is infrastructure-only until explicitly wired.

---

## 6. AuthV2 isolation from domain modules — PASS

| Domain | Imports auth-v2? | Uses Session/Token/Rbac? |
| --- | --- | --- |
| Marketplace | No | No |
| Escrow / Orders | No | No |
| Wallet / Admin / Health | No | No |
| Favorites / Social | No | No |
| Chats / Notifications / Reviews | No | No |
| Profiles | No | No |

**Only bridges into auth-v2:**

- `AuthModule` (dual-access / dual-issue / rollout — flag-gated)
- `common.ts` (`AuthPlatformError` filter mapping)
- `main.ts` (`requestIdMiddleware`)

No domain business logic depends on new Session/JWT.

---

## 7. Feature flags at defaults = old behaviour — PASS

| Flag | Default | Effect when unset |
| --- | --- | --- |
| `USE_NEW_AUTH` | false | Canary new-auth never activates |
| `AUTH_ACCEPT_V2_ACCESS` | false | EdDSA rejected on global guard |
| `AUTH_DUAL_ISSUE_SESSION` | false | No Session on Mini/legacy login |
| `AUTH_DUAL_ISSUE_SET_COOKIE` | false | Reserved; unused |
| `AUTH_NEW_AUTH_CANARY_PERCENT` | 0 | Empty canary set |
| `AUTH_ROLLOUT_OBSERVE` | false | No path/canary log spam |
| `AUTH_DUAL_WRITE_IDENTITY` | **true** | Phase 1 IdentityLink dual-write (intended; pre-dates V2) |

`AuthRolloutService.shouldUseNewAuthForUser()` → **always false** with defaults.  
**Not wired** into domain routing yet (decision API only).

---

## 8. Dead code / TODO inventory

### Not dead — dormant-by-design (keep)

Auth V2 surface (`TokenService`, `SessionService`, `AuthOrchestrator`, `/api/v2/auth`, dual-access, rollout, cookies helpers). Required for future cutover; inactive at defaults.

### Unused on production routes (keep for Phase 2+/admin RBAC)

| Item | Notes |
| --- | --- |
| `PermissionGuard` / `RolesGuard` | Registered; only unit-tested; no `@UseGuards` on domain |
| `RequirePermissions` / `RequireRoles` | Decorators never applied |
| `isDualIssueRefreshCookieEnabled` | Reserved flag; no caller sets cookies from it |
| `shouldUseNewAuthForUser` / `resolveAuthMode` | Used by tests + snapshot; **not** by HTTP routing yet |

### Likely dead helper

| Item | Notes |
| --- | --- |
| `newOpaqueTokenId()` in `identity-link.ts` | **No production callers** found (export only) |

### TODO / FIXME

| Location | Text |
| --- | --- |
| `identity-link.ts` | `TODO(Phase 4 — soft-unlink correctness)` — intentional; runtime unchanged |
| FIXME / HACK / XXX in `src/` | **None** |

### Temporary comments

Architecture/ADR comments only; no “temporary hack” markers beyond the Phase 4 TODO.

**Recommendation:** do **not** delete Auth V2 “unused” guards/flags before Website cutover. Optional cleanup later: `newOpaqueTokenId` if confirmed unused in scripts.

---

## 9. Module architecture

```
AppModule
  ├── DatabaseModule (global Prisma)
  ├── AuthModule ──imports──► AuthV2Module
  ├── AuthV2Module  (also imported by AppModule — redundant, not cyclic)
  ├── Profiles / Marketplace / Social / Escrow / Engagement / Operations
```

| Check | Result |
| --- | --- |
| Circular AuthModule ↔ AuthV2Module | **None** (one-way) |
| Domain → AuthV2 | **None** |
| Session → Token → SigningKeys | Acyclic |
| Orchestrator → Session / Identity / Rollout | Acyclic |
| Removable services today? | **No** — V2 stack is cutover infrastructure |

**Minor smell (Low):** `AppModule` and `AuthModule` both import `AuthV2Module` — redundant Nest import, harmless.

**Do not remove** AuthV2Module from AppModule without verifying Nest provider graph for `APP_GUARD` injection of `DualAccessService` / `AuthRolloutService`.

---

## 10. Scores, risks, gates

### Backend readiness

| Question | % |
| --- | --- |
| Safe Legacy / Mini App production (flags OFF) | **96%** |
| Backend ready for Website canary (after FE+ops) | **82%** |
| Ready for Phase 4 | **70%** |

### Residual risks

| ID | Risk | Severity | When |
| --- | --- | --- | --- |
| R1 | Frontend AuthManager / same-origin `__Host-` missing | **High** (cutover) | Before `USE_NEW_AUTH` |
| R2 | Ed25519 PEMs not required at boot; must exist before v2 login / dual-issue | **High** (cutover) | Before flags on |
| R3 | Soft-delete IdentityLink cleared on login | **Med** | Before unlink / Phase 4 |
| R4 | Dual-issue orphan Sessions if flag on without cookie path | **Low–Med** | Keep flag off |
| R5 | Public profile/reviews still require any valid JWT (legacy behaviour) | **Low** | Product decision, not V2 |
| R6 | New RBAC unused; admin still `isAdmin` shim | **Low** | Post-MVP |

### Must do before `USE_NEW_AUTH=true`

1. Sign off `ONIX-AUTH-P3.3-OPS-CHECKLIST` (topology, restore drill, observe)  
2. Ship Website AuthManager (memory access + cookie refresh + single-flight)  
3. Provision `AUTH_ED25519_CURRENT_*`  
4. Staging: `AUTH_ACCEPT_V2_ACCESS` soak → optional dual-issue → canary 1%…  
5. Rollback rehearsal: `USE_NEW_AUTH=false` / `CANARY=0`  
6. Confirm Mini App still HS256-only (no client change)

### Can do after MVP

- Wire `PermissionGuard` onto admin routes; seed Role/Permission  
- Implement Phase 4 soft-unlink (do not clear `deletedAt` blindly)  
- `AUTH_ENFORCE_IDENTITY_LINK`  
- Remove unused helpers (`newOpaqueTokenId`) if still orphaned  
- Deduplicate `AuthV2Module` import  
- Index/observability dashboards for `auth_rollout_*`  
- Sunset legacy `/telegram-login` only after metrics gate (not Mini App)

---

## Explicit confirmations

1. Legacy endpoints work — **YES**  
2. Mini App compatible — **YES**  
3. No accidental new-auth requirement on domain — **YES**  
4. Correct AuthGuard usage — **YES**  
5. RBAC (legacy `isAdmin`) unchanged — **YES**  
6. AuthV2 isolated from Marketplace…Escrow — **YES**  
7. Default flags = old behaviour — **YES**  
8. Dead/TODO inventory documented — **YES**  
9. Module architecture / no cycles — **YES**  
10. This report — **delivered**

---

## Stop conditions (honoured)

- No new feature code written for this audit  
- Phase 4 **not** started  
- `USE_NEW_AUTH` **not** enabled  
