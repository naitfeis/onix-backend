# ONIX Auth — Phase 3.3 Ops Checklist (before USE_NEW_AUTH=true)

| Field | Value |
| --- | --- |
| **Document** | ONIX-AUTH-P3.3-OPS-CHECKLIST |
| **Date** | 2026-07-15 |
| **Parent** | ADD v1.4 · Runbook · ADR-035 / ADR-036 |
| **Status** | Infrastructure ready — **do not enable** until gates pass |

---

## 0. Current safe defaults (must remain until gates pass)

```
USE_NEW_AUTH=false
AUTH_NEW_AUTH_CANARY_PERCENT=0
AUTH_ACCEPT_V2_ACCESS=false          # enable only after soak decision
AUTH_DUAL_ISSUE_SESSION=false        # enable only after soak decision
AUTH_DUAL_ISSUE_SET_COOKIE=false
AUTH_ROLLOUT_OBSERVE=false           # set true on staging for canary logs
```

Mini App `/api/auth/telegram-mini` stays frozen HS256 regardless of Website canary.

---

## 1. Pre-flight gates (all required)

| # | Gate | Pass criteria |
| --- | --- | --- |
| 1 | Same-origin topology | `https://onix.gg` SPA + `https://onix.gg/api` → Nest (`__Host-` viable) |
| 2 | Ed25519 keys | `AUTH_ED25519_CURRENT_KID` + private/public PEM provisioned (SecretsProvider) |
| 3 | Neon restore drill | RPO ≤ 5 min, RTO ≤ 1 h recorded (ADR-034) |
| 4 | Phase 1 migration | IdentityLink/Session tables live; backfill counts match |
| 5 | Dual-write IdentityLink | `AUTH_DUAL_WRITE_IDENTITY=true`; Mini login creates/updates links |
| 6 | Phase 2 API | `/api/v2/auth/*` healthy on staging; AUTH_* errors contract green |
| 7 | Phase 3.1 dual-accept | Staging: `AUTH_ACCEPT_V2_ACCESS=true` accepts EdDSA + HS256 |
| 8 | Phase 3.2 dual-issue | Staging: `AUTH_DUAL_ISSUE_SESSION=true` creates Session; Mini response unchanged |
| 9 | Frontend AuthManager | Memory-only access; cookie refresh; single-flight; **not shipped until product approve** |
| 10 | Rollback rehearsal | Flip `USE_NEW_AUTH=false` / `CANARY=0` on staging; Website resumes legacy |
| 11 | Observability | `AUTH_ROLLOUT_OBSERVE=true` on staging; dashboards for `auth_rollout_*` logs |
| 12 | Error budget | Auth 5xx / AUTH_* rate within baseline before canary > 0 |

---

## 2. Recommended rollout ladder (Website only)

```
A. Dual readiness (no USE_NEW_AUTH)
   AUTH_ACCEPT_V2_ACCESS=true
   AUTH_DUAL_ISSUE_SESSION=true      # optional; observe Session volume
   AUTH_ROLLOUT_OBSERVE=true
   Soak ≥ 24–72h

B. Canary new-auth (Frontend must already support /api/v2/auth)
   USE_NEW_AUTH=true
   AUTH_NEW_AUTH_CANARY_PERCENT=1 → 5 → 25 → 50 → 100
   Hold each step; watch auth_rollout_canary + AUTH_* + refresh reuse

C. Full cutover
   AUTH_NEW_AUTH_CANARY_PERCENT=100
   Keep legacy /telegram-login until Phase 4 sunset metrics
```

**Do not enable B until Frontend AuthManager is approved and deployed.**

---

## 3. Instant rollback (one ENV change)

Primary (preferred):

```
USE_NEW_AUTH=false
```

or:

```
AUTH_NEW_AUTH_CANARY_PERCENT=0
```

Secondary (narrow dual surface):

```
AUTH_ACCEPT_V2_ACCESS=false
AUTH_DUAL_ISSUE_SESSION=false
```

After rollback: users re-login via legacy Telegram widget / Mini App as before.

---

## 4. Log messages to watch

| `msg` | Meaning |
| --- | --- |
| `auth_rollout_canary` | User bucket / inCanary decision |
| `auth_rollout_path` | legacy_hs256 / v2_access / dual_issue_session / … |
| `auth_rollout_rollback` | Ops logged rollback guidance |
| `auth_dual_issue_session_*` | Phase 3.2 Session dual-issue |
| `auth_v2_*` | Phase 2 login/refresh |

---

## 5. Explicit non-goals until later

- Phase 4 `AUTH_ENFORCE_IDENTITY_LINK` / nullable `telegramId`
- Removing `/api/auth/telegram-login` or Mini App HS256
- Enabling `USE_NEW_AUTH` in production without this checklist signed
