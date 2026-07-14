# ONIX Auth — Phase 3.1 Completion Report

| Field | Value |
| --- | --- |
| **Document** | ONIX-AUTH-P3.1-REPORT |
| **Date** | 2026-07-14 |
| **Baseline** | ADD v1.4 · Runbook · Phase 2 complete |
| **Status** | Phase 3.1 complete — **stop before 3.2** |

---

## 1. Verdict

**Dual Authentication Layer is implemented** behind `AUTH_ACCEPT_V2_ACCESS` (default **false**).

- `USE_NEW_AUTH` remains **false** (untouched)
- Legacy HS256 path unchanged (`AuthService.verifyToken`)
- Mini App /telegram-mini /telegram-login / response contracts unchanged
- No frontend, cookies, refresh, migrations, or new endpoints
- Tests: **52/52** green
- TypeScript: clean

---

## 2. Behaviour

| Bearer token | `AUTH_ACCEPT_V2_ACCESS` | Result |
| --- | --- | --- |
| HS256 (legacy) | any | `AuthService.verifyToken` → `AuthUser` |
| EdDSA (v2 access) | **false** (default) | 401 UnauthorizedException |
| EdDSA (v2 access) | **true** | TokenService → SessionService.validateAccessClaims → `AuthUser` |

Controllers always see `AuthUser` (`id`, `telegramId`, `onixId`, `isAdmin`). No alg branching in business code.

EdDSA failures on the global AuthGuard are mapped to the **same** `UnauthorizedException` message as legacy invalid sessions (response contract preserved on existing routes).

---

## 3. Files

| Path | Change |
| --- | --- |
| `src/auth-v2/auth-v2.flags.ts` | `isAcceptV2AccessEnabled()` |
| `src/auth-v2/dual-access.service.ts` | **new** — EdDSA verify + AuthUser mapping |
| `src/auth-v2/auth-v2.module.ts` | register/export `DualAccessService` |
| `src/auth.module.ts` | AuthGuard dual path; imports `AuthV2Module` |
| `test/auth-v2-phase31-dual-access.test.ts` | **new** Phase 3.1 suite |
| `test/auth-v2-token.test.ts` | flag default assertion |

---

## 4. Explicitly not done (Phase 3.2+)

- Session dual-issue on legacy login
- Canary % / Website AuthManager
- Enabling `USE_NEW_AUTH` or `AUTH_ACCEPT_V2_ACCESS` in production

**Stop here.**
