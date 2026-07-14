# ONIX Auth — Phase 2 Completion Report

| Field | Value |
| --- | --- |
| **Document** | ONIX-AUTH-P2-REPORT |
| **Date** | 2026-07-14 |
| **Baseline** | ADD v1.4 · Runbook · ADR-001…044 |
| **Status** | Phase 2 complete — stop before Phase 3 |

---

## 1. Verdict

**Phase 2 implementation is complete** for the Website auth platform backend surface.

- `USE_NEW_AUTH` remains **false** (default)
- Mini App `/api/auth/telegram-mini` + HS256 JWT **unchanged**
- Legacy `/api/auth/telegram-login` **retained**
- No frontend / AuthManager / Phase 3 cutover
- Tests: **41/41** green
- TypeScript: clean (`tsc --noEmit`)
- No new Prisma migrations (uses Phase 1 tables)

---

## 2. Delivered increments

| Increment | Contents |
| --- | --- |
| **2.1** | TokenService, SecretsProvider, SigningKeyService (Ed25519 + kid), AUTH_* errors |
| **2.2** | SessionService (CAS rotate, reuse, timeouts, TrustedDevice, audits, SecurityEvent) |
| **2.3** | AuthOrchestrator, IdentityService, TelegramLoginVerifier, versioned AuthEventPublisher (ADR-031 TX login) |
| **2.4** | `AuthV2Controller` under `/api/v2/auth` |
| **2.5** | AuthV2Guard, RolesGuard, PermissionGuard, RbacService (in-memory `pv` cache) |
| **2.6** | Refresh cookie helpers (`__Host-onix_rt` when Secure; `onix_rt` when `AUTH_COOKIE_SECURE=false`), CSRF header, Set-Cookie on login/refresh/logout |
| **2.7** | Unit/integration-style tests across token, session, orchestrator pieces, cookies, guards |

---

## 3. API surface (`/api/v2/auth`)

| Method | Path | Auth |
| --- | --- | --- |
| POST | `/api/v2/auth/login` | Public (Telegram widget payload) |
| POST | `/api/v2/auth/refresh` | Refresh cookie + `X-ONIX-CSRF: 1` |
| POST | `/api/v2/auth/logout` | Bearer access + CSRF |
| POST | `/api/v2/auth/logout-all` | Bearer access + CSRF |
| GET | `/api/v2/auth/me` | Bearer access |
| GET | `/api/v2/auth/sessions` | Bearer access |
| DELETE | `/api/v2/auth/sessions/:id` | Bearer access |

Controller is `@Public()` so legacy global `AuthGuard` does not reject Ed25519 tokens; protected routes use `@UseGuards(AuthV2Guard)`.

---

## 4. Production safety

| Control | Status |
| --- | --- |
| Default client path | Still Mini App + legacy website JWT |
| V2 endpoints present | Yes — opt-in by callers; not used by current frontend |
| Signing keys | Required only when issuing v2 access tokens (`AUTH_ED25519_CURRENT_*`) |
| Cookies | Set only by v2 login/refresh/logout responses |
| Exception filter | Maps `AuthPlatformError` → stable `AUTH_*` envelope without changing legacy HttpException shape |

---

## 5. Env checklist (ops, when exercising v2)

```
AUTH_ED25519_CURRENT_KID=
AUTH_ED25519_CURRENT_PRIVATE_PEM=
AUTH_ED25519_CURRENT_PUBLIC_PEM=
# optional previous kid/public for rotation verify
BOT_TOKEN=                 # Telegram widget verify (same as legacy)
AUTH_COOKIE_SECURE=true    # production → __Host-onix_rt
USE_NEW_AUTH=false         # keep until Phase 3
```

---

## 6. Explicitly out of Phase 2 (deferred)

- Website frontend / AuthManager cutover (Phase 3)
- RiskEngine ML / impossible-travel auto revoke
- MFA runtime
- Google / Email / Passkey adapters
- Account merge execution
- Removing `telegramId` / legacy endpoints

---

## 7. Known follow-ups (non-blocking for Phase 2 close)

1. Gate finding **H1**: dual-write still clears `IdentityLink.deletedAt` on login — fix before unlink API.  
2. Gate finding **H4**: ensure Phase 1 Neon migration applied before staging v2 traffic.  
3. Full Nest e2e (supertest against listening app) optional; current suite covers services/guards/cookies/crypto.  
4. Seed RBAC roles for admin permissions when using PermissionGuard on future admin routes.

---

## 8. Sign-off

| Gate | Result |
| --- | --- |
| Phase 2 scope complete | **Yes** |
| Mini App compatibility | **Preserved** |
| Ready for Phase 3 (Website cutover) | **Only after** product approval + `onix.gg/api` topology + canary `USE_NEW_AUTH` |

**Stop here. Do not start Phase 3 without explicit approval.**
