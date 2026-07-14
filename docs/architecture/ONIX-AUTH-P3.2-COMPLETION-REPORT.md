# ONIX Auth — Phase 3.2 Completion Report

| Field | Value |
| --- | --- |
| **Document** | ONIX-AUTH-P3.2-REPORT |
| **Date** | 2026-07-15 |
| **Baseline** | ADD v1.4 · Phase 3.1 dual-access |
| **Status** | Phase 3.2 complete — **stop before 3.3** |

---

## Verdict

Session dual-issue after legacy Telegram login is implemented behind `AUTH_DUAL_ISSUE_SESSION` (**default false**).

- HS256 response contracts for `/telegram-mini` and `/telegram-login` **unchanged**
- `USE_NEW_AUTH` remains **false**
- No cookies on Mini App responses (`AUTH_DUAL_ISSUE_SET_COOKIE` reserved, default false)
- No frontend / AuthManager / new endpoints / migrations
- Fail-open: Session create errors never break legacy login
- Tests: **60/60** green · TypeScript clean

---

## Behaviour

| Flag | Effect |
| --- | --- |
| `AUTH_DUAL_ISSUE_SESSION=false` | Identical to pre-3.2 |
| `AUTH_DUAL_ISSUE_SESSION=true` | After upsert, Orchestrator creates one Session (refresh hash + LOGIN_SUCCESS); response still HS256 only |

Opaque refresh plaintext is discarded (contract freeze). Cookie helpers from Phase 2 remain unused by legacy controllers.

---

## Stop

Do **not** start Phase 3.3 without explicit approval.
