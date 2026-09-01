# ONIX — AI CODEBASE MAP
## Authoritative repository structure + reconciliation with legacy structure

> PURPOSE: This file is an AI-oriented map of the ONIX repository.
> It exists so Cursor can understand the repository architecture quickly instead of spending tokens rediscovering it.
>
> AUTHORITY:
> 1. `ONIX-FILE-STRUCTURE(1).txt` = CURRENT repository file inventory.
> 2. `СТРУКУТУРА.txt` = OLD / LEGACY architecture summary.
> 3. When they disagree, the CURRENT inventory wins.
>
> IMPORTANT:
> - Do not assume the old structure is still accurate.
> - Do not create duplicate modules because an old document mentions a different location.
> - Search the current repository before changing an existing feature.
> - The repository contains generated/build output and IDE metadata; these are not primary source code.
>
> PRODUCTION (2026-09): public site is Amvera Moscow at https://www.onixtg.shop.
> Full ops map: `docs/architecture/ONIX-AMVERA-PRODUCTION.md` and
> `docs/Documentation/Onix-Notes.md` §0.1. Do not follow Vercel→Render webhook
> URLs in older architecture reports.

---

# 1. CURRENT ARCHITECTURE AT A GLANCE

ONIX is currently organized as a monorepo-like repository containing:

- root infrastructure/configuration;
- Prisma schema and migrations;
- `onix-frontend` — the user-facing React/Vite SPA;
- `onix-admin` — the separate admin React/Vite application;
- `safe-deal-platform` — the NestJS backend;
- `public/spa` — built frontend assets served/deployed by the backend;
- `docs` — architecture, audit and learning documentation;
- operational scripts, drills, patches and test artifacts.

The most important source-code areas are:

```text
safe-deal-platform/     Backend / NestJS
onix-frontend/          Main user frontend / React
onix-admin/             Admin frontend / React
prisma/                 Database schema + migrations
docs/architecture/      Architecture decisions and operational knowledge
```

---

# 2. CURRENT VS OLD STRUCTURE

The old file `СТРУКУТУРА.txt` describes a simplified layout with:
- a root `safe-deal-platform/` concept;
- `onix-frontend/`;
- backend modules;
- economy/wallet/payments/trust/pro/analytics;
- auth-v2, login-challenge, MFA, risk, realtime, observability, idempotency and workers.

The CURRENT inventory confirms most of those concepts, but the repository is now more detailed and has additional first-class areas.

## Important reconciliation

### Current root structure

Current repository has:
- root `package.json`, `package-lock.json`;
- root `prisma/`;
- root `docs/`;
- root `ops/`;
- root `ops-drills/`;
- root `patches/`;
- root `scripts/`;
- root `public/spa/`;
- `onix-frontend/`;
- `onix-admin/`;
- `safe-deal-platform/`.

The old document did not explicitly show `onix-admin/` as a separate application. It must therefore be treated as CURRENT and authoritative.

### Backend

Current backend is:

`safe-deal-platform/src/`

The backend is NOT a single flat CRUD application. It contains dedicated security, identity, economy, realtime, observability and worker domains.

### Frontend

Current user frontend is:

`onix-frontend/src/`

Current admin frontend is:

`onix-admin/src/`

Do not confuse the admin application with `onix-frontend/src/screens/Admin.tsx`.
They are separate frontend surfaces.

### Built SPA

`public/spa/` contains generated/bundled frontend output.

Treat it as BUILD OUTPUT, not as the primary source of frontend behavior.

When changing UI source code, modify `onix-frontend/` or `onix-admin/`, not `public/spa/` manually, unless explicitly debugging generated output.

---

# 3. CURRENT FILE INVENTORY

The following is the CURRENT repository inventory. It is intentionally grouped for AI navigation rather than reproduced as a meaningless flat list.

## ROOT

```text
.env
.env.example
.gitignore
package.json
package-lock.json
prisma.config.ts
amvera.yaml / amvera.yml     # Moscow deploy (Amvera reads this; do not overwrite via empty UI form)
render.yaml                  # Render staging only
README.md
tsconfig.json
scripts/start-amvera.mjs     # migrate deploy + start (DATABASE_URL required at runtime)
```

Additional root artifacts may exist for temporary diagnostics/build output. Do not treat files such as `api_ready.tmp`, `build-out.txt`, `typecheck-out.txt`, `tsc-*.txt` as architectural source.

---

# 4. DATABASE

```text
prisma/
├── schema.prisma
├── migration_lock.toml
└── migrations/
    ├── 20260625190049_init_highload_schema/
    ├── 20260712140000_onix_backend/
    ├── 20260712223000_telegram_profile_sync/
    ├── 20260714190000_auth_phase1_identity_platform/
    ├── 20260715150000_login_challenge/
    ├── 20260715210000_session_previous_refresh_hash_idx/
    ├── 20260715220000_chat_member_userid_index/
    ├── 20260715230000_stage_5_5_trade_support/
    ├── 20260715234500_stage_5_5_1_abuse_risk/
    ├── 20260716010000_stage_5_5_2_ban_public/
    ├── 20260716020000_stage_5_5_3_direct_chat_pair/
    ├── 20260716030000_stage_5_5_4_report_visible_msg/
    ├── 20260716040000_stage_5_5_5_unify_pair_chat/
    ├── 20260716050000_perf_hot_path_indexes/
    ├── 20260717180000_stage1_trust_economy_foundation/
    ├── 20260717190000_stage1_ux_fix2_deposit_chat/
    ├── 20260717193000_message_deleted_for_all/
    ├── 20260717220000_stage1_title_desc_pricing/
    ├── 20260717230000_stage1_reports_sellban_dispute/
    ├── 20260717240000_onix_ai_product_session/
    ├── 20260717250000_stage2_platform_status/
    ├── 20260718120000_favorite_analytics_indexes/
    ├── 20260718140000_ai_support_reports/
    ├── 20260718150000_super_admin_status/
    ├── 20260718160000_ops_idempotency_workers/
    ├── 20260719180000_payment_provider_ref_unique/
    ├── 20260723200000_add_cs2_fortnite_valorant_gta_categories/
    ├── 20260723210000_add_dota_pubg_genshin_ml_appstore/
    ├── 20260723220000_add_pubg_minecraft_ps_stalcraft_poe2/
    ├── 20260724160000_order_clawback_worker_lease/
    ├── 20260725133645_add_mfa_step_up/
    ├── 20260725160000_mfa_step_up_purpose/
    ├── 20260725170000_drop_parked_chat_attachments/
    ├── 20260725180000_ledger_actor_source_correlation/
    ├── 20260725210000_ledger_fund_provenance/
    └── 20260725220000_admin_control_plane/
```

Database is critical infrastructure. Schema changes can affect backend, workers, wallet/ledger, auth and admin.

---

# 5. DOCUMENTATION

```text
docs/
├── architecture/          # includes ONIX-AMVERA-PRODUCTION.md
├── Documentation/         # Onix-Notes.md, PS_Onix-FileStructure.md
├── audit/
└── learning/
```

`docs/architecture/` contains architecture and operational decisions, including:
- **current prod:** `ONIX-AMVERA-PRODUCTION.md`
- auth;
- identity;
- privacy/security;
- Telegram login;
- marketplace;
- escrow/orders;
- chat;
- WebSocket/realtime;
- production infrastructure;
- performance;
- trust;
- key rotation;
- admin control plane.

IMPORTANT:
Architecture docs are useful context, but the current source code and current file inventory are authoritative when documentation is stale.

`docs/learning/` is educational material and should not be treated as runtime architecture.

---

# 6. ADMIN FRONTEND

```text
onix-admin/
├── index.html
├── package.json
├── package-lock.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
└── src/
    ├── api/client.ts
    ├── App.tsx
    ├── main.tsx
    ├── screens/
    │   ├── AuditLogScreen.tsx
    │   ├── DashboardScreen.tsx
    │   ├── LoginScreen.tsx
    │   ├── OrdersScreen.tsx
    │   ├── RiskEventsScreen.tsx
    │   ├── SecurityFlagsScreen.tsx
    │   ├── UserInvestigateScreen.tsx
    │   └── WithdrawalsScreen.tsx
    ├── styles/admin.css
    └── vite-env.d.ts
```

Purpose:
Separate administrative control plane.

Do not treat admin UI as normal marketplace UI.

Important domains:
- audit;
- orders;
- risk;
- security flags;
- user investigation;
- withdrawals;
- admin authentication.

---

# 7. USER FRONTEND

```text
onix-frontend/
├── package.json
├── package-lock.json
├── vite.config.ts
├── index.html
├── vercel.json
├── public/
├── scripts/
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── App.css
    ├── index.css
    ├── api/
    ├── auth/
    ├── components/
    ├── design-system/
    ├── hooks/
    ├── i18n/
    ├── perf/
    ├── pwa/
    ├── realtime/
    ├── screens/
    ├── shell/
    ├── styles/
    └── utils/
```

## Frontend API

```text
src/api/
├── client.ts
├── contracts.ts
├── fetchResilience.ts
├── client.test.ts
├── contract-matrix.test.ts
├── contracts.test.ts
├── fetchResilience.test.ts
└── README.md
```

Purpose:
HTTP/API boundary and contracts.

Do not put financial truth here.

## Frontend authentication

```text
src/auth/
├── apiConfig.ts
├── AuthManager.ts
├── AuthManager.test.ts
├── authBroadcast.ts
├── AuthV2WebsiteAuthProvider.ts
├── LegacyWebsiteAuthProvider.ts
├── createWebsiteAuthProvider.ts
├── sharedAuthManager.ts
├── memoryAccessToken.ts
├── refreshClient.ts
├── botLogin.ts
├── botLogin.test.ts
├── v2AuthApi.ts
├── v2AuthApi.test.ts
├── mode.ts
├── types.ts
├── deviceInfo.ts
├── telegramEnv.ts
├── telegramEnv.test.ts
├── telegramPayload.ts
├── auth.phase-a.test.ts
└── auth.phase-c.test.ts
```

AuthManager is the central frontend auth lifecycle abstraction.

Do not create a second independent auth manager without a strong reason.

## Frontend realtime

```text
src/realtime/client.ts
```

Realtime is delivery, not source of truth.

## Frontend screens

```text
src/screens/
├── Admin.tsx
├── AuthGate.tsx
├── Chats.tsx
├── Deals.tsx
├── Market.tsx
├── ProductForm.tsx
├── Profile.tsx
├── SellerAnalytics.tsx
├── SupportQueue.tsx
├── shared.tsx
└── types.ts
```

Main user-facing product areas:
- market;
- product creation;
- deals/orders;
- profile;
- chats;
- seller analytics;
- support.

## Frontend design system

```text
src/design-system/
├── index.tsx
├── modalStack.ts
└── tests
```

Shared visual/interaction primitives live here.

## Frontend utilities

```text
src/utils/
├── categoryImages.ts
├── globalErrorHandlers.ts
├── lazyRetry.ts
├── matchCategorySearch.ts
├── onixId.ts
├── parseMemberTokens.ts
├── productValidation.ts
├── productValidation.test.ts
└── publicAt.ts
```

Do not move domain/financial rules here merely for convenience.

---

# 8. BACKEND — CORE

```text
safe-deal-platform/src/
├── main.ts
├── worker.main.ts
├── app.module.ts
├── auth.module.ts
├── marketplace.module.ts
├── escrow.module.ts
├── profiles.module.ts
├── operations.module.ts
├── support.module.ts
├── engagement.module.ts
├── social.module.ts
├── prisma.service.ts
├── env.ts
├── safe-error-log.ts
├── health.ts
├── catalog.ts
├── pricing.ts
├── platform-status.ts
├── ban-policy.ts
├── response.ts
├── validation-errors.ts
├── common.ts
├── query-selects.ts
├── rate-limit.ts
├── sanitize-user-text.ts
├── security-headers.ts
├── request-timing.middleware.ts
├── http-noise.middleware.ts
├── spa-static.ts
├── debug-endpoints.ts
├── ops-gates.ts
├── onix-id.ts
├── onix-id-lookup.ts
├── public-username.ts
├── identity-link.ts
├── chat-pair.ts
├── dispute-card.ts
├── delivery-crypto.ts
├── domain-notify.ts
└── ...
```

These files are shared/core infrastructure. Before adding a new utility, search here first.

---

# 9. BACKEND — AUTH V2 / IDENTITY

```text
safe-deal-platform/src/auth-v2/
├── auth-errors.ts
├── auth-events.ts
├── auth-orchestrator.service.ts
├── auth-rollout.service.ts
├── auth-session-path.middleware.ts
├── auth-v2.controller.ts
├── auth-v2.dto.ts
├── auth-v2.flags.ts
├── auth-v2.guards.ts
├── auth-v2.module.ts
├── debug-session.controller.ts
├── device-trust.service.ts
├── dual-access.service.ts
├── google-login.verifier.ts
├── identity.service.ts
├── rbac.service.ts
├── refresh-cookie.ts
├── request-id.middleware.ts
├── secrets.provider.ts
├── secrets-inventory.ts
├── session.constants.ts
├── session.service.ts
├── session-probe.controller.ts
├── signing-key.service.ts
├── telegram-login.verifier.ts
└── token.service.ts
```

This is a critical security domain.

Responsibilities:
- identity;
- sessions;
- Ed25519 signing;
- tokens;
- refresh cookies;
- device trust;
- RBAC;
- rollout;
- Telegram identity verification.

Do not casually modify auth or replace the existing flow.

---

# 10. BACKEND — TELEGRAM LOGIN CHALLENGE

```text
safe-deal-platform/src/login-challenge/
├── bot-login.controller.ts
├── bot-telegram-api.ts
├── bot-webhook.handler.ts
├── login-challenge.flags.ts
├── login-challenge.module.ts
├── login-challenge.repository.ts
├── login-challenge.service.ts
├── login-challenge-prompt.ts
└── login-session-cookie.ts
```

Purpose:
Telegram Bot based login/identity confirmation.

Telegram is an identity verification mechanism; ONIX database remains the source of truth.

Critical chain:

Website
→ login challenge
→ Telegram bot
→ webhook
→ confirmation
→ verified Telegram identity
→ ONIX auth/session
→ website session.

---

# 11. BACKEND — MFA

```text
safe-deal-platform/src/mfa/
├── mfa.controller.ts
├── mfa.module.ts
├── mfa.types.ts
└── mfa-step-up.service.ts
```

Purpose:
Step-up authentication for sensitive actions.

Do not bypass MFA from frontend.

---

# 12. BACKEND — RISK

```text
safe-deal-platform/src/risk/
├── risk.module.ts
├── risk-engine.scoring.ts
├── risk-engine.service.ts
└── risk-engine.types.ts

safe-deal-platform/src/risk-score.service.ts
```

Purpose:
Risk scoring, security decisions and risk-related enforcement.

Risk is security infrastructure, not just analytics.

Sensitive actions may involve:
- withdrawals;
- suspicious marketplace activity;
- abuse;
- account/service/virtual-good risks;
- chat-related signals.

Do not directly mutate financial state from chat/moderation code. Route through proper risk/domain services.

---

# 13. BACKEND — ECONOMY / MONEY

```text
safe-deal-platform/src/economy/
├── economy.controller.ts
├── economy.module.ts
├── analytics/
│   ├── analytics-foundation.service.ts
│   └── seller-analytics.service.ts
├── payments/
│   ├── manual.provider.ts
│   ├── payment-provider.ts
│   ├── payments.service.ts
│   └── payment-webhook-model.ts
├── pro/
│   └── pro.service.ts
├── trust/
│   ├── trust.service.ts
│   └── trust-card.ts
└── wallet/
    ├── balance.service.ts
    ├── clawback.service.ts
    ├── correlation-id.ts
    ├── cuid.ts
    ├── deposit.service.ts
    ├── fund-provenance.ts
    ├── ledger-model.ts
    ├── ledger-write.types.ts
    ├── lock.service.ts
    ├── wallet-economy.service.ts
    └── withdraw-velocity.ts
```

This is one of the highest-risk areas.

Financial truth must remain backend/database controlled.

`SellerVerification` and its runtime service are retired; historical migrations may still contain their original definitions.

Key concepts:
- wallet;
- available/locked funds;
- deposits;
- withdrawals;
- ledger;
- fund provenance;
- clawback;
- payment provider;
- payment reconciliation;
- seller analytics;
- trust.

Do not implement money as a simple mutable frontend balance.

---

# 14. BACKEND — IDEMPOTENCY

```text
safe-deal-platform/src/idempotency/
├── idempotency.module.ts
└── idempotency.service.ts
```

Purpose:
Prevent duplicate effects from retries/repeated requests.

Especially important for:
- payments;
- withdrawals;
- ledger operations;
- webhooks;
- critical state transitions.

---

# 15. BACKEND — REALTIME

```text
safe-deal-platform/src/realtime/
├── realtime.module.ts
├── realtime.types.ts
├── realtime-auth.service.ts
├── realtime-bus.service.ts
└── realtime-hub.service.ts
```

Purpose:
Realtime event delivery.

Architecture principle:

DATABASE/API = truth
REALTIME = delivery.

If realtime fails, state must still be recoverable through API.

---

# 16. BACKEND — OBSERVABILITY

```text
safe-deal-platform/src/observability/
├── alerting.service.ts
├── error-tracking.service.ts
├── graceful-shutdown.ts
├── metrics.middleware.ts
├── metrics.service.ts
├── money-event.ts
├── observability.controller.ts
├── observability.module.ts
└── structured-logger.ts
```

Purpose:
- logs;
- metrics;
- error tracking;
- alerting;
- graceful shutdown;
- money event observability.

Do not log secrets, tokens or sensitive credentials.

---

# 17. BACKEND — WORKERS

```text
safe-deal-platform/src/workers/
├── worker.module.ts
├── worker-lock.service.ts
├── worker-runner.service.ts
└── jobs/
    ├── chat-attachment-cleanup.job.ts
    ├── clawback-recover.job.ts
    ├── deposit-unlock.job.ts
    ├── idempotency-cleanup.job.ts
    ├── ledger-reconciliation.job.ts
    ├── payment-intent-expire.job.ts
    ├── payment-reconciliation.job.ts
    ├── security-ip-retention.job.ts
    └── trust-recompute.job.ts
```

Workers perform asynchronous/recovery/maintenance tasks.

Financial reconciliation and clawback jobs are critical.

---

# 18. BACKEND — CHAT ATTACHMENTS

```text
safe-deal-platform/src/chat-attachments/
├── attachment-policy.ts
├── chat-attachments.controller.ts
├── chat-attachments.module.ts
├── chat-attachments.service.ts
├── magic-bytes.ts
└── r2-storage.service.ts
```

Purpose:
Chat file attachments via Cloudflare R2 (`r2-storage.service.ts`).

Needs runtime `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_BUCKET`. Without them, upload-intent returns unavailable.

Browser presigned PUT targets Cloudflare — may fail from RU. Magic-byte and
size checks stay on the Nest complete path.

---

# 19. BACKEND — AVATARS

```text
safe-deal-platform/src/avatars/
├── avatar.controller.ts
├── avatar.service.ts
├── avatars.module.ts
└── avatar-url.ts
```

Purpose:
User avatar handling and URL generation.

---

# 20. BACKEND — AI

```text
safe-deal-platform/src/ai/
├── ai.controller.ts
├── ai.module.ts
├── ai.service.ts
├── conversation.service.ts
├── help-replies.ts
└── intent-recognizer.ts
```

Purpose:
ONIX AI chat, marketplace help and support handoff.

Lot creation and withdrawals are intentionally unavailable through AI chat. They remain normal application flows and must not be added as AI intents or instructions.

---

# 21. ADMIN BACKEND

```text
safe-deal-platform/src/admin/
├── admin.controller.ts
├── admin.guard.ts
├── admin.module.ts
├── admin-auth.controller.ts
├── admin-auth.service.ts
├── admin-cookie.ts
├── admin-crypto.ts
├── admin-ip-allowlist.ts
├── admin-security.service.ts
├── admin-session.service.ts
└── admin-token.service.ts
```

Purpose:
Administrative control plane and privileged operations.

This is security-critical.

---

# 22. TESTS

Backend tests:

```text
safe-deal-platform/test/
├── admin-auth.slice6.test.ts
├── admin-plane.slice6.test.ts
├── ai-onix.test.ts
├── auth-v2-phase2.test.ts
├── auth-v2-phase31-dual-access.test.ts
├── auth-v2-phase32-dual-issue.test.ts
├── auth-v2-phase33-rollout.test.ts
├── auth-v2-session.test.ts
├── auth-v2-token.test.ts
├── avatar-url.test.ts
├── backend.test.ts
├── backup-restore-drill-url.test.ts
├── backup-restore-toc.test.ts
├── bot-login-webhook-ux.test.ts
├── client-ip.test.ts
├── deposit-transfer.test.ts
├── device-trust-privacy.test.ts
├── economy-foundation.test.ts
├── idempotency-memory.test.ts
├── ledger-property.test.ts
├── login-challenge-phase-d.test.ts
├── magic-bytes.test.ts
├── mfa-step-up.slice3.test.ts
├── monetary-invariants.e2e.test.ts
├── observability.test.ts
├── onix-id.test.ts
├── payment-webhook-gate.test.ts
├── public-username.test.ts
├── realtime-bus.test.ts
├── risk-engine.slice2.test.ts
├── safe-error-log.test.ts
├── sanitize-user-text.test.ts
├── secrets-hygiene.slice5.test.ts
├── security-headers.test.ts
├── staff-viewer.test.ts
└── withdraw-provenance.slice41.test.ts
```

Tests reveal important invariants. Before changing critical logic, inspect related tests.

Frontend tests are located next to source modules in `onix-frontend/src/`.

---

# 23. SCRIPTS

Backend scripts:

```text
safe-deal-platform/scripts/
├── backfill-identity-links.ts
├── backup-restore-drill.ts
├── backup-restore-toc.ts
├── explain-previous-refresh-hash.ts
├── explain-products-list.ts
├── generate-ed25519.ts
├── load-test-monetary.ts
├── money-audit.ts
└── payment-launch-gate.ts
```

These are operational/development tools.

Root/frontend scripts also exist.

---

# 24. BUILD OUTPUT

```text
public/spa/
```

contains compiled frontend/admin assets.

Examples:
- hashed JS;
- CSS;
- fonts;
- category images;
- PWA files;
- generated admin bundle.

This is generated output.

Do not manually edit it to implement application behavior.

Source:
- user frontend → `onix-frontend/`
- admin frontend → `onix-admin/`

---

# 25. OPS / DRILLS / PATCHES

```text
ops/
└── alerting-rules.json

ops-drills/
└── database/restore drill artifacts

patches/
└── @prisma+adapter-pg+7.8.0.patch
```

These are operational/support artifacts, not normal application domain code.

---

# 26. IDE / TEMPORARY / GENERATED FILES

The current inventory contains `.idea/`, `_tmp-liquid-glass/`, build outputs and diagnostic files.

AI RULE:

Do not use IDE metadata or temporary experiments as architectural evidence.

Examples:
- `.idea/*`
- `_tmp-liquid-glass/*`
- `build-out.txt`
- `typecheck-out.txt`
- `tsc-*.txt`
- generated `public/spa/assets/*`

These should normally be ignored when reasoning about application architecture.

---

# 27. DOMAIN MAP

Use this map when locating code:

| Domain | Primary location |
|---|---|
| User authentication | `safe-deal-platform/src/auth-v2/` |
| Telegram login | `safe-deal-platform/src/login-challenge/` |
| MFA | `safe-deal-platform/src/mfa/` |
| Identity | `safe-deal-platform/src/auth-v2/identity.service.ts`, `identity-link.ts` |
| RBAC | `safe-deal-platform/src/auth-v2/rbac.service.ts` |
| Marketplace | `safe-deal-platform/src/marketplace.module.ts` + related services |
| Orders/Escrow | `safe-deal-platform/src/escrow.module.ts` + order/domain implementation |
| Wallet | `safe-deal-platform/src/economy/wallet/` |
| Ledger | `safe-deal-platform/src/economy/wallet/ledger-*` |
| Payments | `safe-deal-platform/src/economy/payments/` |
| Withdrawals | wallet/economy + worker/reconciliation code |
| Risk Engine | `safe-deal-platform/src/risk/` |
| Chat | frontend `screens/Chats.tsx` + backend chat-related core/domain code |
| Attachments | `safe-deal-platform/src/chat-attachments/` |
| Realtime | `safe-deal-platform/src/realtime/` + `onix-frontend/src/realtime/` |
| Notifications/events | realtime/domain notification infrastructure |
| AI | `safe-deal-platform/src/ai/` |
| Seller analytics | `safe-deal-platform/src/economy/analytics/` + frontend `SellerAnalytics.tsx` |
| Trust | `safe-deal-platform/src/economy/trust/` |
| ONIX Pro | `safe-deal-platform/src/economy/pro/` |
| Admin backend | `safe-deal-platform/src/admin/` |
| Admin frontend | `onix-admin/` |
| Database | `prisma/` |
| Background jobs | `safe-deal-platform/src/workers/` |
| Observability | `safe-deal-platform/src/observability/` |
| Idempotency | `safe-deal-platform/src/idempotency/` |

---

# 28. CRITICAL ARCHITECTURAL INVARIANTS

## Money

Backend/database is the source of truth.

Do not trust:
- frontend amount;
- frontend commission;
- frontend balance;
- frontend order status.

Money operations must consider:
- transactionality;
- concurrency;
- idempotency;
- ledger correctness;
- fund provenance;
- reconciliation.

## Authentication

Do not bypass:
- AuthManager;
- backend auth guards;
- session service;
- refresh flow;
- identity verification.

## Telegram

Telegram is not ONIX's database.

Telegram confirms identity; ONIX owns the user/session/domain state.

## Realtime

Realtime delivers events.

It is not the source of truth.

## Risk

Risk decisions belong to the risk/security layer.

Do not create random `if (suspicious) ban()` logic inside unrelated services.

## Workers

Workers can perform recovery/reconciliation tasks.

They must remain safe under retries and leases.

---

# 29. HOW CURSOR SHOULD SEARCH

When asked to change a feature:

1. Identify the domain.
2. Search the current repository.
3. Find the existing implementation.
4. Find its tests.
5. Find related DTO/controller/service/module.
6. If database-related, inspect `prisma/schema.prisma` and relevant migrations.
7. If money-related, inspect wallet/ledger/payment/idempotency/risk interactions.
8. If auth-related, inspect auth-v2/login-challenge/session/token flow.
9. Make the smallest safe change.
10. Run relevant tests.

Do not reread the entire repository.

---

# 30. SEARCH ROUTING CHEATSHEET

If request says:

### "Исправь вход / авторизацию"
Start:
```text
safe-deal-platform/src/auth-v2/
safe-deal-platform/src/login-challenge/
onix-frontend/src/auth/
```

### "Исправь оплату"
Start:
```text
safe-deal-platform/src/economy/payments/
safe-deal-platform/src/economy/wallet/
safe-deal-platform/src/idempotency/
safe-deal-platform/src/workers/
```

Then inspect tests:
```text
payment-webhook-gate.test.ts
monetary-invariants.e2e.test.ts
deposit-transfer.test.ts
```

### "Исправь вывод"
Start:
```text
safe-deal-platform/src/economy/wallet/
safe-deal-platform/src/risk/
safe-deal-platform/src/mfa/
safe-deal-platform/src/idempotency/
```

### "Исправь риск"
Start:
```text
safe-deal-platform/src/risk/
safe-deal-platform/src/admin/
safe-deal-platform/test/risk-engine.slice2.test.ts
```

### "Исправь Telegram login"
Start:
```text
safe-deal-platform/src/login-challenge/
safe-deal-platform/src/login-challenge/bot-webhook.handler.ts
safe-deal-platform/src/auth-v2/telegram-login.verifier.ts
safe-deal-platform/src/auth-v2/auth-orchestrator.service.ts
onix-frontend/src/auth/botLogin.ts
onix-frontend/src/screens/AuthGate.tsx
docs/architecture/ONIX-AMVERA-PRODUCTION.md
```

Bare `/start` is ignored. Webhook is POST-only on www.onixtg.shop. Confirm
`getWebhookInfo` + Amvera logs `[Bot] webhook hit`.

### "Исправь Google login"
Start:
```text
safe-deal-platform/src/auth-v2/google-login.verifier.ts
safe-deal-platform/src/auth-v2/auth-v2.controller.ts   # GET public-config, POST google
onix-frontend/src/screens/AuthGate.tsx
onix-frontend/src/auth/v2AuthApi.ts
```

Amvera: `GOOGLE_CLIENT_ID` only (no Client Secret). SPA reads
`GET /api/v2/auth/public-config` because Vite env is not baked on Amvera builds.

### "Прод / Amvera / DNS / сертификат"
Start:
```text
docs/architecture/ONIX-AMVERA-PRODUCTION.md
docs/Documentation/Onix-Notes.md          # §0.1
amvera.yaml
scripts/start-amvera.mjs
```

### "Исправь чат"
Start:
```text
onix-frontend/src/screens/Chats.tsx
onix-frontend/src/realtime/
safe-deal-platform/src/realtime/
safe-deal-platform/src/chat-attachments/
```

Then search backend chat/domain implementation rather than assuming a single chat module exists.

### "Исправь админку"
Start:
```text
onix-admin/
safe-deal-platform/src/admin/
```

Do not confuse with:
```text
onix-frontend/src/screens/Admin.tsx
```

---

# 31. OLD STRUCTURE — WHAT TO DISREGARD

The old `СТРУКУТУРА.txt` is a compact conceptual map, not the current complete tree.

Examples of information that must NOT override current files:

- old claim that the repository is simply a `safe-deal-platform` root;
- old abbreviated `economy/` tree;
- old `onix-frontend/` summary;
- old omission of `onix-admin/`;
- abbreviated backend module list.

The current inventory is much more detailed and must be used for exact file paths.

---

# 32. WHAT NOT TO DO

Do NOT:

- invent a new service when an existing service already owns the domain;
- create `AuthService2`, `PaymentService2`, etc. without necessity;
- put money logic in React;
- trust client-provided financial values;
- manually edit generated `public/spa` assets;
- use old architecture documents as proof that a file still exists;
- change database schema without considering migrations;
- bypass idempotency for retriable operations;
- bypass risk/security checks;
- bypass authentication;
- delete tests because they make a refactor inconvenient;
- perform a massive refactor for a small feature.

---

# 33. MINIMAL-CHANGE PRINCIPLE

ONIX is an existing production-oriented system.

Default strategy:

SEARCH → UNDERSTAND → PATCH → TEST

not:

READ EVERYTHING → REWRITE EVERYTHING.

When a task is small, change only the smallest relevant surface.

When a task affects:
- money;
- auth;
- database;
- risk;
- admin security;

treat it as high impact and inspect the complete relevant flow before editing.

---

# 34. FINAL AI CONTEXT

The repository currently has four major application/data surfaces:

```text
                    ONIX
                      │
       ┌──────────────┼──────────────┐
       │              │              │
   USER WEB       ADMIN WEB       BACKEND
onix-frontend/   onix-admin/   safe-deal-platform/
                                      │
                                      │
                                  PostgreSQL
                                      │
                                  prisma/
```

Backend critical domains:

```text
AUTH / IDENTITY
      │
      ├── auth-v2
      ├── login-challenge
      └── mfa

MARKETPLACE
      │
      └── marketplace / escrow / profiles / support

MONEY
      │
      ├── economy/payments
      ├── economy/wallet
      ├── idempotency
      └── workers/reconciliation

SECURITY
      │
      ├── risk
      ├── admin
      ├── device trust
      └── observability

REALTIME
      │
      ├── realtime backend
      └── realtime frontend
```

When uncertain, search the current source tree.

When current code and old documentation disagree, current code wins.

When money/security/auth is involved, correctness wins over convenience.

---

# 35. CURRENT INVENTORY SOURCE

The full machine-generated inventory is stored separately as:

`ONIX-FILE-STRUCTURE(1).txt`

This document is the human/AI semantic layer built on top of that inventory.

Recommended usage in Cursor:
- keep this file as the architecture/index context;
- keep the raw TXT as the exact current file inventory;
- update both after major structural changes.
