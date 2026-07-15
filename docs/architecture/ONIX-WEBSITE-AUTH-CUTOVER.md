# ONIX Website Auth Cutover — Plan (corrected)

| Field | Value |
| --- | --- |
| **Document** | ONIX-WEBSITE-AUTH-CUTOVER |
| **Date** | 2026-07-15 |
| **Status** | Phase A in progress / approved plan |
| **Backend** | Phase 1–3 **FROZEN** |

Companion checklist: `ONIX-WEBSITE-AUTH-TESTS.md`.

## Increments

| Phase | Goal | Backend flags |
| --- | --- | --- |
| **A** | Same-origin scaffolding + `WebsiteAuthProvider` (Legacy \| AuthV2) | unchanged / off |
| **B** | AuthManager: memory access, single-flight, cross-tab, **refresh storm** | off |
| **C** | Widget → `/api/v2/auth/login` then **always** `/api/v2/auth/me` | off |
| **D** | Interceptors, 401 recovery, sessions UX | off |
| **D.5** | Full manual e2e checklist (no backend flag changes) | off |
| **E** | Discuss staging `AUTH_ACCEPT_V2_ACCESS` only after D.5 sign-off | staging only |

## Hard rules

- Do not edit `vercel.json` unless the existing `/api` rewrite is proven broken.
- Temporary FE mode via `VITE_WEBSITE_AUTH_MODE` — remove after Auth V2 soak (not a permanent dual auth layer).
- Do not enable `USE_NEW_AUTH` / canary in this cutover prep.
- Stop after each phase for Architecture / TS / Tests / Production Safety / Rollback reviews.
