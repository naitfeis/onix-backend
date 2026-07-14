# ONIX Authentication Architecture Design Document

| Field | Value |
| --- | --- |
| **Document** | ONIX-AUTH-ADD |
| **Version** | 1.4 |
| **Status** | Ready for **Phase 1 only** (schema/backfill/dual-write) — see Phase Runbook |
| **Priority** | Critical |
| **Project** | ONIX Marketplace |
| **Date** | 2026-07-14 |
| **Supersedes** | ONIX-AUTH-ADD v1.3 |
| **Scope** | Website Authentication Platform redesign |
| **Companion** | `docs/architecture/ONIX-AUTH-PHASE-RUNBOOK.md` |

---

## 0. Executive Summary

### Ownership principle (normative)

> **ONIX является владельцем учетной записи.** Telegram, Google, Apple, Discord, Steam, VK, Email и Passkey являются **взаимозаменяемыми Identity Providers**. Потеря любого отдельного провайдера не должна лишать пользователя доступа к его ONIX Account при наличии хотя бы одного другого подтверждённого метода входа.

### Final topology decision

```
https://onix.gg          → Website SPA
https://onix.gg/api      → NestJS API (reverse proxy / same origin)
Cookie: __Host-onix_rt   → valid (Secure, Path=/, no Domain)
```

**Rejected for production auth cookies:** `app.onix.gg` + `api.onix.gg` (forces BFF or `SameSite=None`, weaker CSRF story).

### Dual runtime

| Surface | Path | Policy |
| --- | --- | --- |
| Mini App | `POST /api/auth/telegram-mini` | Frozen |
| Website | `/api/v2/auth/*` | New session platform |

### Headline controls (v1.3)

- `IdentityLink` = sole external identity source (soft-delete)
- Unified `Session` (device + refresh hash + riskScore + family chain)
- `sessionVersion` kill switch on access JWT
- **Access JWT: EdDSA (Ed25519)** with `kid` + key rotation (current + previous)
- Secrets via `SecretsProvider` (ENV now → Vault/KMS later)
- Dedicated **Risk Engine**; MONITOR-only impossible travel at start
- RBAC + `permissionVersion` / cache strategy; MFA stubs
- Account **Merge** protocol designed (build with 2nd IdP)
- Session expiration: idle + absolute + remember/trusted policies
- Stable auth **error codes**; security **notifications** via Event Bus
- Observability: correlation/request IDs, metrics, tracing, structured logs
- Full **ADR** catalogue (§22)
- TrustedDevice + SecurityScore + Recovery Codes (phased)
- No `ADMIN_LOGIN_AS_USER` in MVP

---

## 1. Final Review Verdicts (15 proposals)

| # | Proposal | Verdict | Phase |
| --- | --- | --- | --- |
| 1 | Same-origin `onix.gg` + `/api` | **ACCEPT** (binding decision) | Infra before Website cutover |
| 2 | Impossible travel = monitor-only first | **ACCEPT** | Risk v1 → promote later |
| 3 | IdP order: TG → Email → Google → Passkey → … | **ACCEPT** (with note) | Roadmap |
| 4 | Exclude ADMIN_LOGIN_AS_USER from MVP | **ACCEPT** | Post-RBAC + audit maturity |
| 5 | TrustedDevice entity | **ACCEPT** | Schema Phase 1; UX after Email |
| 6 | Session RiskScore 0–100 + decision enum | **ACCEPT** | With Risk Engine |
| 7 | IdentityHistory immutable table | **ACCEPT** (narrow scope) | Phase 1 schema |
| 8 | Formal refresh family tree | **ACCEPT** | Session model |
| 9 | Expanded device fingerprint fields | **ACCEPT with limits** | Core now; Canvas/WebGL later |
| 10 | Risk Engine as separate service | **ACCEPT** (reaffirm) | From day one of v2 |
| 11 | User SecurityScore 0–100 | **ACCEPT as derived** | After ≥2 IdP factors exist |
| 12 | Recovery Codes architecture | **ACCEPT design; defer build** | After Email Magic Link |
| 13 | Formal Domain Event catalogue | **ACCEPT** | Event bus from Phase 2 |
| 14 | Adapter-only IdP extensibility | **ACCEPT** (already core) | Continuous |
| 15 | Enterprise readiness review | **DONE** — §18 | — |

### Explicitly deferred / partially rejected

| Item | Stance | Why |
| --- | --- | --- |
| Auto `REVOKE_ALL` on impossible travel | Reject for early phases | VPN/CGNAT/mobile false positives |
| Canvas/WebGL/Resolution fingerprint in Phase 1 | Defer | Privacy + brittleness; weak security ROI early |
| SecurityScore as hard auth gate | Reject | Circular lockouts; use as signal only |
| ADMIN_LOGIN_AS_USER | Reject from MVP | Highest-risk admin capability |
| Separate RefreshToken table | Reject (keep unified Session) | Family tree fits Session + hash chain |

---

## 2. Cookie Topology (binding ADR-020)

### Decision

Serve Website and API on **one registrable origin**:

| URL | Role |
| --- | --- |
| `https://onix.gg` | SPA |
| `https://onix.gg/api/*` | API (proxy to Nest) |

Refresh cookie:

```
Set-Cookie: __Host-onix_rt=<opaque>; HttpOnly; Secure; Path=/; SameSite=Lax
```

Access token: **memory only** (never `localStorage` / `sessionStorage`).

### Why not `app.` + `api.` subdomains

| Concern | Same-origin `/api` | Split subdomains |
| --- | --- | --- |
| `__Host-` cookies | Works | Fails across hosts |
| SameSite | First-party natural | Often needs `None`+`Secure` |
| CSRF | Simpler | Harder |
| BFF | Not required | Usually required |
| Infra | One TLS cert / one CDN | More moving parts |
| Browser quirks | Fewer | More |

### Stronger alternative considered — and rejected as default

**Dedicated auth BFF on `onix.gg`** that sets cookies and proxies upstream API workers: also valid at Stripe-scale, but unnecessary if API already mounts at `/api`. ONIX should **not** invent a BFF until there is a hard reason (multi-service mesh, edge auth, etc.).

**Staging:** use `https://staging.onix.gg` with the same `/api` pattern — never mix staging SPA with prod API cookies.

---

## 3. Risk Engine & Impossible Travel (ADR-021)

### Separation

```
AuthOrchestrator
    → RiskEngine.evaluate(RiskContext): RiskDecision
    → apply decision (Auth still owns session mutations)
```

`RiskEngine` **must not** live inside `AuthService`. Future ML/antifraud replaces the engine internals without touching login/refresh code.

### Decision enum

```ts
type RiskAction = 'ALLOW' | 'MONITOR' | 'STEP_UP' | 'REVOKE_ALL' | 'BLOCK';
```

### Impossible travel policy

| Phase | Policy |
| --- | --- |
| **v1 (Phase 1–3)** | **MONITOR only** — emit `SecurityEvent(IMPOSSIBLE_TRAVEL)`, raise Session/User risk scores, write AuthAudit — **no auto logout** |
| **v2** | Optional `STEP_UP` when MFA/Email challenge exists |
| **v3** | `REVOKE_ALL` only with tuned thresholds + allowlist TrustedDevice/VPN ASNs |

**Rationale:** VPN, mobile carrier NAT, travel, and “Wi‑Fi → LTE” hops create chronic false positives. Auth0/Stripe-class systems bias to step-up over silent mass logout for first-party consumer apps.

---

## 4. Identity Provider Roadmap (ADR-022)

Official order:

1. **Telegram** — existing user base / Mini App bridge  
2. **Email Magic Link** — universal **Recovery Provider**, not owned by one IdP corp  
3. **Google** — high conversion, consumer familiarity  
4. **Passkey (WebAuthn)** — phishing-resistant primary long-term  
5. **Steam** — marketplace audience fit  
6. **Discord** — community / gaming  
7. **VK** — regional coverage  
8. **Apple** — required when iOS native/app store surfaces demand it  

**Why Email before Google:** recovery and anti-lockout independence from Telegram *and* from Google account bans. Google remains important but is a poor sole recovery root.

**Note (2026):** Passkey could argue for earlier placement; ONIX still ships Email first because magic link works on every device without platform authenticator UX gaps, then promotes Passkey aggressively.

---

## 5. ADMIN_LOGIN_AS_USER (ADR-023)

**Excluded from MVP and from Phase 1–4.**

Revisit only when:

1. AuthAuditLog immutable pipeline proven  
2. RBAC (`Permission` codes) live  
3. Break-glass procedure + dual control (two admins) designed  
4. Session marked `impersonationOfUserId` with UI banner + forced short TTL  

Until then: support uses read-only admin tools, not session hijack-as-user.

---

## 6. Data Model Additions (design-only)

### 6.1 TrustedDevice

```prisma
model TrustedDevice {
  id               String    @id @default(cuid())
  userId           BigInt
  fingerprintHash  String    @db.VarChar(64)
  deviceName       String?   @db.VarChar(120)
  browser          String?   @db.VarChar(64)
  os               String?   @db.VarChar(64)
  trustedAt        DateTime  @default(now())
  expiresAt        DateTime? // optional trust TTL
  lastSeenAt       DateTime  @default(now())
  revokedAt        DateTime?
  trustSource      String    @db.VarChar(32) // USER_MARK | MFA_REMEMBER | HIGH_SCORE
  user             User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, fingerprintHash])
  @@index([userId, revokedAt])
}
```

**Effects:** lowers RiskScore weight for known device; future MFA “remember this device”; never sole authenticator.

### 6.2 Session — risk + family + fingerprint

```prisma
model Session {
  id                  String    @id @default(cuid())
  userId              BigInt
  familyId            String    @db.VarChar(64)
  refreshGeneration   Int       @default(0)  // A=0, B=1, C=2…
  refreshTokenHash    String    @unique @db.VarChar(64)
  previousRefreshHash String?   @db.VarChar(64)
  // optional compact chain for reuse detection beyond previous:
  // store last N hashes in RefreshFamilyEpoch table if needed — see §7

  riskScore           Int       @default(0)  // 0..100
  riskUpdatedAt       DateTime?

  deviceName          String?   @db.VarChar(120)
  browser             String?   @db.VarChar(64)
  os                  String?   @db.VarChar(64)
  platform            String?   @db.VarChar(64)
  timezone            String?   @db.VarChar(64)
  language            String?   @db.VarChar(32)
  userAgent           String?   @db.VarChar(512)
  fingerprintHash     String?   @db.VarChar(64)
  // Phase 2+ optional entropy (nullable until collected):
  screenResolution    String?   @db.VarChar(32)
  webglHash           String?   @db.VarChar(64)
  canvasHash          String?   @db.VarChar(64)

  ipAddress           String?   @db.VarChar(64)
  asn                 Int?
  country             String?   @db.VarChar(2)
  city                String?   @db.VarChar(120)

  createdAt           DateTime  @default(now())
  lastSeenAt          DateTime  @default(now())
  refreshExpiresAt    DateTime
  absoluteExpiresAt   DateTime
  revokedAt           DateTime?
  revokeReason        SessionRevokeReason?
  // …
}
```

**Fingerprint purpose limitation:** security only (risk, trust, theft signals). Not advertising, not cross-site tracking. Document in privacy policy. Phase 1 collects: browser, OS, timezone, language, UA, IP, ASN, country. Canvas/WebGL/resolution = Phase 2+.

### 6.3 IdentityHistory (immutable)

```prisma
enum IdentityHistoryAction {
  LINKED
  UNLINKED
  RELINKED
  PROFILE_REFRESHED
  PRIMARY_CHANGED
  RECOVERY_MARKED
}

model IdentityHistory {
  id               BigInt                @id @default(autoincrement())
  userId           BigInt
  provider         AuthProvider
  providerUserId   String                @db.VarChar(191)
  action           IdentityHistoryAction
  identityLinkId   String?
  actorUserId      BigInt?               // self vs admin (admin path future)
  ipAddress        String?               @db.VarChar(64)
  metadata         Json?
  createdAt        DateTime              @default(now())

  @@index([userId, createdAt])
  @@index([provider, providerUserId])
}
```

Complements AuthAuditLog: **IdP-centric forensic ledger** for disputes (“when was Telegram unlinked?”). No deletes.

### 6.4 User.securityScore

```prisma
// on User
securityScore     Int       @default(0)  // 0..100, derived cache
securityScoreAt   DateTime?
```

Recomputed by subscriber on `IdentityLinked` / `Mfa*` / `TrustedDevice*` events. **Signal for Marketplace**, not an auth hard gate in early phases.

### 6.5 Recovery Codes (design; build after Email)

```prisma
model RecoveryCode {
  id        String    @id @default(cuid())
  userId    BigInt
  codeHash  String    @db.VarChar(64)  // store hash only
  createdAt DateTime  @default(now())
  usedAt    DateTime?
  @@index([userId])
}
```

Flow: user enables recovery → shown once → hashes stored → consume one code after identity loss challenge → force link new IdP + `sessionVersion++` + revoke sessions. **Not in Phase 1 implementation.**

---

## 7. Refresh Token Family Tree (ADR-024)

### Model

Each login creates a **family** (`familyId`). Each successful refresh advances a **generation** and replaces `refreshTokenHash`:

```
Login:  gen0 hash(A)   familyF
Refresh: gen1 hash(B)  previous=hash(A)
Refresh: gen2 hash(C)  previous=hash(B)
Refresh: gen3 hash(D)  previous=hash(C)
```

### Reuse detection

If presented token hashes to:

1. **Current** `refreshTokenHash` → rotate (happy path)  
2. **`previousRefreshHash`** (or any hash in family denylist) → **reuse**  
3. Unknown → 401  

On reuse of B when current is D:

- Invalidate **entire family F** (all generations conceptually revoked by `Session.revokedAt`)  
- `sessionVersion++` (recommended)  
- `SecurityEvent(REFRESH_TOKEN_THEFT)`  
- Domain event `RefreshReuseDetected`  

Optional hardening (Phase 2): table `RefreshFamilyDeadHash(familyId, tokenHash)` retaining last N rotated hashes (e.g. 32) so reuse of older than `previous` still detects theft (parallel-tab edge vs attacker with old token).

### Parallel tabs

Client **single-flight** refresh mutex. Server: only `previous` grace is optional (≤5s) — default **strict**; prefer single-flight over grace to keep theft detection sharp.

---

## 8. Risk Context → Session RiskScore

Factors (weighted; exact weights tunable):

| Factor | Direction |
| --- | --- |
| New IP / new country vs last session | ↑ |
| VPN / TOR / suspicious ASN | ↑ |
| Unknown fingerprint | ↑ |
| TrustedDevice match | ↓ |
| UA anomaly / automation markers | ↑ |
| Refresh reuse signal | ↑↑ (usually immediate REVOKE path) |
| Login velocity | ↑ |
| High User.securityScore + stable history | ↓ |

Persisted: `Session.riskScore` updated on login/refresh. Engine returns `RiskAction` independently of score thresholds (rules may short-circuit).

---

## 9. Domain Events (formal catalogue)

Auth publishes **after successful commit** via Event Bus only:

| Event | When |
| --- | --- |
| `UserLoggedIn` | IdP callback success |
| `UserLoginFailed` | verify/risk block |
| `SessionCreated` | new device session |
| `SessionRevoked` | logout / limit / risk / admin |
| `Logout` | current session |
| `LogoutAll` | all sessions |
| `RefreshRotated` | successful refresh |
| `RefreshReuseDetected` | theft path |
| `IdentityLinked` | link |
| `IdentityUnlinked` | soft unlink |
| `PasswordlessLogin` | Email magic link success |
| `TrustedDeviceAdded` / `TrustedDeviceRevoked` | trust changes |
| `SecurityEventRaised` | antifraud queue |
| `SecurityScoreUpdated` | derived recompute |
| `SessionsGloballyInvalidated` | sessionVersion bump |
| `MfaChallengeIssued` / `Passed` / `Failed` | future |

**Auth must not** import notification, analytics, Discord, or email senders.

---

## 10. IdentityProvider adapter (unchanged contract)

```ts
interface IdentityProvider {
  readonly provider: AuthProvider;
  verify(input: unknown, ctx: RequestContext): Promise<NormalizedIdentity>;
  link(userId: bigint, input: unknown, ctx: RequestContext): Promise<IdentityLink>;
  unlink(userId: bigint, ctx: RequestContext): Promise<void>;
  refreshProfile(link: IdentityLink, ctx: RequestContext): Promise<NormalizedIdentity>;
}
```

New IdP = new adapter + route registration + feature flag. **No** AuthOrchestrator structural change. **No** User schema change.

---

## 11. API / Cookie / Session policies (stable)

- Base Website auth: **`/api/v2/auth`**
- Mini App: frozen `/api/auth/telegram-mini`
- Max **10** sessions; 11th creates → revoke oldest `lastSeenAt`
- Soft-delete IdentityLink; forbid unlink of last active factor
- Multi-key rate limit: IP · providerUserId · IdentityLink · fingerprint · Session · User
- Access JWT claims: `sub`, `sid`, `sv`, `typ`, `amr`, `acr?`

---

## 12. Phased delivery (implementation still not started)

| Phase | Content | Gate |
| --- | --- | --- |
| **0** | ADD v1.2 acceptance | This review |
| **1** | Additive schema (IdentityLink, Session, audits, TrustedDevice, scores…) + backfill | Mini App e2e green |
| **2** | `/api/v2/auth` + RiskEngine MONITOR + Event Bus | Contract tests |
| **3** | Website cutover on `onix.gg` same-origin | `__Host-` works in prod topology |
| **4** | Email Magic Link + Recovery Codes design→build | Telegram-independent recovery |
| **5** | Google → Passkey; Risk STEP_UP; drop telegramId column | Ownership principle proven |
| **6** | Steam/Discord/VK/Apple as needed; optional ADMIN_LOGIN_AS_USER | RBAC mature |

---

## 13–17. (Carry-forward from v1.1)

Principles, dual runtime, guards, CSRF, RBAC, MFA stubs, migration dual-write for `telegramId` → IdentityLink, and success criteria from v1.1 remain in force unless overridden by §1–§12 of this document.

Key retained ADRs: IdentityLink sole source; unified Session; sessionVersion; `/api/v2/auth`; soft-delete identities; immutable AuthAuditLog; SecurityEvent queue; MFA schema-only; no roles-on-User.

---

## 18. Enterprise Readiness Review (2026)

### 18.1 What truly strengthens the architecture

| Item | Why it matters |
| --- | --- |
| Same-origin cookie topology | Makes `__Host-` real; removes entire class of auth bugs |
| IdentityLink-only ownership + Email-before-Google | Actual recovery; not Telegram-shaped forever |
| sessionVersion + refresh family reuse | Instant revoke + theft containment |
| Dedicated RiskEngine + MONITOR-first | Antifraud scalability without UX self-DoS |
| Domain Event Bus | Keeps Auth pure; enables notify/ML later |
| Adapter IdP interface | Multi-year extensibility |
| TrustedDevice + SecurityScore (derived) | MFA/marketplace readiness |
| Immutable auth + identity ledgers | Disputes, compliance, incident response |
| Excluding impersonation from MVP | Avoids shipping the most abuse-prone admin tool early |

### 18.2 What is excessive / should stay thin

| Item | Guidance |
| --- | --- |
| Canvas/WebGL fingerprint at day one | Defer — privacy, instability, spoofability |
| IdentityHistory **and** full AuthAuditLog | Keep both but **narrow** IdentityHistory to IdP lifecycle only (accepted) |
| SecurityScore as blocker | Derived signal only until model proven |
| Auto impossible-travel logout | Excessive early — MONITOR first |
| Full Recovery Codes before Email IdP | Design yes; build after Email |
| Dead-hash ring of 32 from day one | Optional; `previousRefreshHash` enough for MVP |
| BFF | Unnecessary given same-origin decision |

### 18.3 Additional modern practices (2026) — status after v1.3

| Practice | Status |
| --- | --- |
| Asymmetric access JWT (Ed25519) + kid rotation | **Normative now** (§21.1–21.2) |
| Account merge protocol | **Designed now**; build with 2nd IdP (§21.6) |
| KMS/Vault secrets path | **Architected**; ENV at Phase 1 (§21.3) |
| DPoP / sender-constrained refresh | Deferred (optional hardening) |
| Continuous access eval on escrow | Deferred (use `sv` + session check) |
| Passkeys as primary | Roadmap #4 |
| HIBP / stuffing for Email | With Email IdP phase |
| GDPR vs immutable audit playbook | Legal before wide FP |
| IdP outage mode | Emerges when Email ships |
| OIDC as IdP for partners | Out of scope |

### 18.4 Residual risks (still true)

| Residual risk | Notes |
| --- | --- |
| Telegram required until Email ships | Time-boxed product dependency |
| Email inbox takeover | Short TTL, device bind, later step-up |
| Fingerprint spoofing | Soft signal only |
| GeoIP false labels | MONITOR-first |
| Mini App dual path | Accepted constraint |
| Merge edge cases / disputes | Policy in §21.6; ops runbook later |
| Immutable logs vs erasure | Legal design |
| CDN mis-route breaks `__Host-` | Ops gate before Website cutover |
| Insider admin abuse | RBAC maturity path |

### 18.5 Auth0 / Clerk / GitHub / Stripe lens

Unchanged from v1.2: hybrid opaque refresh + short JWT, rotation, separate risk, adapter IdPs, defer impersonation — **aligned**. ONIX correctly builds first-party auth for escrow. v1.3 closes the gap they would flag first: **asymmetric JWT + kid rotation**, **merge policy**, **error contract**, **observability**.

---

## 19. Closed decisions (cumulative)

| Topic | Resolution |
| --- | --- |
| Cookie topology | `onix.gg` + `onix.gg/api` |
| Impossible travel | MONITOR only until evidence |
| Next IdP | Email Magic Link |
| ADMIN_LOGIN_AS_USER | Not in MVP |
| Access JWT alg | **Ed25519 (EdDSA)** + `kid` |
| Secrets | SecretsProvider: ENV → Vault/KMS |
| Account merge | Explicit protocol; not silent auto-merge |
| Auth errors | Stable `AUTH_*` codes |

### Ops gates before Website cutover (Phase 3)

1. TLS + reverse proxy: `onix.gg` → SPA, `onix.gg/api` → Nest.  
2. Legal note: fingerprint purpose limitation + audit retention.  
3. Ed25519 key material provisioned via SecretsProvider.

**Phase 1 (additive schema) may start without production `onix.gg` cutover** — schema and dual-write do not require `__Host-` cookies yet.

---

## 20. Approval

| Role | Decision | Date |
| --- | --- | --- |
| Architecture | v1.3 crypto/ops review recorded | 2026-07-14 |
| Product / Owner | ☐ Accept v1.3 | |
| Implementation | **Architecture is ready for Phase 1 implementation** | |

---

## 21. Enterprise Crypto / Ops / Product Gaps — Final Assessment (v1.3)

For each item: **Include now** (normative in ADD + Phase 1 schema or Phase 2 API contract) · **Defer build** · **Reject**.  
Complexity: S / M / L. Migration impact: None / Low / Medium / High.

### 21.1 JWT Signing Strategy

| Field | Value |
| --- | --- |
| **Verdict** | **INCLUDE NOW** (normative) |
| **Decision** | Website access JWT: **EdDSA / Ed25519** (`alg: EdDSA`). Reject HS256 for `/api/v2/auth`. ES256 acceptable alternative; Ed25519 preferred (smaller keys, fast, modern default). |
| **Why** | HS→asymmetric migration later forces dual-verify windows and mobile/SPA pain. Multi-service verify must not share HMAC secret. |
| **Complexity** | M (TokenService + key load + tests) |
| **Migration** | Medium for Website (greenfield v2). Mini App **keeps existing HS256 JWT** until optional later migration (frozen path). AuthGuard: verify by `alg`/`typ` — EdDSA for `typ=access` web; HS256 for mini legacy. |
| **Phase** | Design Phase 0; implement with Phase 2 TokenService; generate first key pair in Phase 1 secrets checklist |

Header claims: `alg: EdDSA`, `typ: JWT`, **`kid: <key id>`**.  
Body: `sub`, `sid`, `sv`, `pv` (permissionVersion, optional), `amr`, `iss`, `aud`, `iat`, `exp`.

### 21.2 Key Rotation (`kid`)

| Field | Value |
| --- | --- |
| **Verdict** | **INCLUDE NOW** (architecture); **build with Phase 2** |
| **Model** | `SigningKey{ kid, publicKey, privateKeyRef, status: CURRENT\|PREVIOUS\|RETIRED, activatedAt, retiredAt }` |
| **Rotation** | Issue new CURRENT → demote old to PREVIOUS → verify accepts CURRENT+PREVIOUS → after max access TTL (e.g. 15m+skew) RETIRE previous |
| **Why** | Rotate without mass logout; compromise containment; enterprise baseline (Auth0/Okta JWKS pattern) |
| **Complexity** | M |
| **Migration** | Low if introduced with v2 (no HS256 web tokens in prod yet) |
| **Expose** | Optional `GET /api/v2/auth/.well-known/jwks.json` (public keys only) for future services |

Refresh tokens remain **opaque** (not JWT) — rotation of signing keys does not invalidate refresh; only access reissue uses new `kid`.

### 21.3 Secrets Management

| Field | Value |
| --- | --- |
| **Verdict** | **INCLUDE NOW** (abstraction); Vault/KMS **deferred** |
| **Model** | `SecretsProvider` interface: `get(name)`, signing key material by `kid`, pepper for refresh/recovery hashes |
| **Path** | Phase 1–2: ENV / file-mounted secrets → Phase 4+: Vault/KMS behind same interface |
| **Why** | Avoid rewriting TokenService when leaving ENV; document threat model (no secrets in git, no logs) |
| **Complexity** | S (interface + ENV adapter); L later for KMS |
| **Migration** | None if interface exists from day one |
| **Reject** | Hard-coding “Vault required before Phase 1” — overkill for current stage |

### 21.4 Permission Caching (RBAC)

| Field | Value |
| --- | --- |
| **Verdict** | **INCLUDE design NOW**; **Redis cache DEFER** until RBAC on hot paths |
| **Strategy** | (1) `User.permissionVersion` (`pv`) bumped on role/permission change — mirror of `sessionVersion`. (2) Access JWT may carry `pv`. (3) Guard loads permissions from **cache** keyed `perms:{userId}:{pv}` (in-process LRU first; Redis when multi-instance). (4) **Do not** embed full permission array in JWT (bloat + stale without `pv`). |
| **Why** | DB join every request does not scale; JWT-only perms go stale without versioning |
| **Complexity** | S design; M with Redis |
| **Migration** | Low — additive `permissionVersion` |
| **Phase** | Column in Phase 1 schema; cache impl when Admin RBAC routes ship |

### 21.5 Concurrent Refresh / Optimistic Session Lock

| Field | Value |
| --- | --- |
| **Verdict** | **INCLUDE NOW** (normative refresh algorithm) |
| **Algorithm** | Atomic rotate: `UPDATE Session SET refreshTokenHash=new, previousRefreshHash=old, refreshGeneration=g+1, lockVersion=lockVersion+1 WHERE id=? AND refreshTokenHash=oldHash AND revokedAt IS NULL`. If `count=0` → either parallel refresh (other tab won) or reuse/theft → re-read row: if `previousRefreshHash==presented` within **strict** policy treat as reuse; client single-flight preferred. Optional `lockVersion` for general optimistic concurrency. |
| **Why** | Dual-tab refresh is the #1 false “theft” source; must be designed, not discovered in prod |
| **Complexity** | M |
| **Migration** | None (new Session table) |
| **Phase** | Phase 2 refresh endpoint — **required**, not optional |

Also: frontend **single-flight** refresh mutex (architecture requirement on AuthManager).

### 21.6 Account Merge

| Field | Value |
| --- | --- |
| **Verdict** | **INCLUDE architecture NOW**; **build DEFERRED** to Email/Google phase |
| **Problem** | User A has Telegram; User B has Google; same human proves both → two ONIX wallets/orders |
| **Policy (normative)** | **Never silent auto-merge.** Conflict on `IdentityLink` unique `(provider, providerUserId)` if already bound. Cross-account link attempt → `AUTH_ACCOUNT_MERGE_REQUIRED` + start **MergeRequest** flow. |
| **Flow** | 1) Authenticated as A attempts to link IdP owned by B (or login with IdP of B while session A). 2) Create `AccountMergeRequest{ survivorUserId, absorbedUserId, status, evidence }`. 3) Require proof on **both** sides (re-auth both IdPs or Email confirmations). 4) Transaction: move IdentityLinks (soft-delete duplicates), reassign business FKs to survivor (orders, balance rules — **product**: prefer sum balances with ledger entry; products/orders → survivor). 5) `sessionVersion++` on both; revoke all sessions; IdentityHistory + AuthAudit; DomainEvent `AccountMerged`. 6) Absorbed user `deletedAt` or `mergedIntoUserId`. |
| **Survivorship** | Default: **older account** (lower `User.id` / earlier `createdAt`) is survivor unless admin override (future). Wallet: credit absorbed balance to survivor via ledger (never delete money). |
| **Why design now** | Without policy, second IdP creates irreversible duplicates |
| **Complexity** | L (product + data migration per entity) |
| **Migration** | High when executed; design-only impact now = None |
| **Reject** | Automatic merge on email match heuristics |

### 21.7 Security Notification Policy

| Field | Value |
| --- | --- |
| **Verdict** | **INCLUDE policy NOW**; **channels DEFER** until Email (and optional TG notify) |
| **Triggers** | `UserLoggedIn` (new device/fingerprint), `TrustedDeviceAdded`, `RefreshReuseDetected`, `SecurityEventRaised` (high severity), `IdentityLinked`/`Unlinked`, `LogoutAll`, `AccountMerge*` |
| **Channels (priority)** | Email (when linked) → Telegram bot DM (when TG linked) → Push (future) |
| **Architecture** | Notification **subscriber** on Domain Event Bus — Auth does not send messages |
| **Complexity** | S policy; M per channel |
| **Migration** | None |
| **Phase** | Wire Email notifier with Email IdP; TG notify optional earlier via bot |

### 21.8 Session Expiration Policy

| Field | Value |
| --- | --- |
| **Verdict** | **INCLUDE NOW** (normative defaults) |

| Policy | Default | Notes |
| --- | --- | --- |
| **Access TTL** | 15 minutes | Memory only |
| **Idle timeout** | 14 days without refresh/lastSeen | Sliding via refresh; update `lastSeenAt` |
| **Absolute lifetime** | 90 days from session create | `absoluteExpiresAt`; force re-IdP |
| **Refresh TTL** | min(idle remaining, absolute) | Cookie Max-Age aligned |
| **Remember me** | Extends idle to **30 days**; absolute still 90d | Flag on Session at login |
| **TrustedDevice** | Does **not** by itself extend absolute; may reduce RiskScore / skip step-up later | Not a forever session |
| **Max sessions** | 10 | Oldest idle evicted |

| Complexity | S |  
| Migration | None |  
| Phase | Fields in Phase 1; enforce in Phase 2 |

### 21.9 API Error Contract

| Field | Value |
| --- | --- |
| **Verdict** | **INCLUDE NOW** (normative for `/api/v2/auth`) |

Stable machine-readable `error.code` (plus human `message`):

| Code | HTTP | Meaning |
| --- | --- | --- |
| `AUTH_INVALID_TOKEN` | 401 | Access JWT bad/expired/sv mismatch |
| `AUTH_REFRESH_MISSING` | 401 | No refresh cookie |
| `AUTH_REFRESH_REUSED` | 401 | Theft/reuse path |
| `AUTH_SESSION_EXPIRED` | 401 | Idle/absolute/revoked |
| `AUTH_SESSION_LIMIT` | 401/409 | Optional signal when evicted (usually silent) |
| `AUTH_ACCOUNT_LOCKED` | 403 | deletedAt / admin lock |
| `AUTH_ACCOUNT_DISABLED` | 403 | Alias/policy |
| `AUTH_STEP_UP_REQUIRED` | 403 | Risk/MFA gate (body may include `challengeId`) |
| `AUTH_PROVIDER_REJECTED` | 401 | IdP verify failed |
| `AUTH_IDENTITY_CONFLICT` | 409 | IdP bound to another user |
| `AUTH_ACCOUNT_MERGE_REQUIRED` | 409 | Merge flow needed |
| `AUTH_LAST_FACTOR` | 400 | Cannot unlink last IdP |
| `AUTH_RATE_LIMITED` | 429 | Multi-key limiter |
| `AUTH_CSRF_REJECTED` | 403 | Missing/invalid CSRF header |

Envelope remains `{ success: false, error: { code, message, details? } }`.  
| Complexity | S | Migration | Low (v2 only) | Phase | Phase 2 controllers |

### 21.10 Observability

| Field | Value |
| --- | --- |
| **Verdict** | **INCLUDE NOW** (minimum bar with Phase 2) |
| **Requirements** | `X-Request-Id` generated/propagated; **correlationId** in logs; **structured JSON logs** (no token/cookie values); metrics: `auth_login_success|fail`, `auth_refresh_success|fail|reuse`, `auth_session_revoked`, `risk_action_total{action}`; tracing spans around IdP verify, refresh TX, RiskEngine |
| **Why** | Undebuggable auth is an outage amplifier |
| **Complexity** | M |
| **Migration** | None |
| **Phase** | Middleware Phase 2; dashboards Phase 3+ |

### 21.11 Summary matrix

| # | Item | Include architecture | Build phase | Complexity | Migration |
| --- | --- | --- | --- | --- | --- |
| 1 | Ed25519 JWT | **Now** | Phase 2 (keys checklist Phase 1) | M | Med (web greenfield; mini HS256 stays) |
| 2 | kid rotation | **Now** | Phase 2 | M | Low |
| 3 | SecretsProvider | **Now** | Phase 1 interface / ENV | S→L | None |
| 4 | Perm cache + `pv` | **Now** | Column P1; Redis later | S–M | Low |
| 5 | Optimistic refresh | **Now** | Phase 2 **required** | M | None |
| 6 | Account merge | **Now** | With 2nd IdP | L | High when run |
| 7 | Security notifications | **Now** | With Email (+ events) | S–M | None |
| 8 | Expiration policy | **Now** | Phase 1 fields / P2 enforce | S | None |
| 9 | Error contract | **Now** | Phase 2 | S | Low |
| 10 | Observability | **Now** | Phase 2 minimum | M | None |

**Nothing in this list is rejected.** Nothing critical is “unknown.” Deferred items are explicitly build-deferred with normative design.

---

## 22. Architecture Decision Records (ADR catalogue)

| ID | Title | Decision | Status |
| --- | --- | --- | --- |
| ADR-001 | IdentityLink sole IdP source | No IdP PK on User as source of truth | Accepted |
| ADR-002 | Mini App auth frozen | `/api/auth/telegram-mini` + hash unchanged | Accepted |
| ADR-003 | Access memory / refresh `__Host-` | No web storage for long-lived tokens | Accepted |
| ADR-004 | Unified Session table | Device + refresh hash together | Accepted |
| ADR-005 | sessionVersion kill switch | Instant access invalidate | Accepted |
| ADR-006 | IdentityProvider interface | verify/link/unlink/refreshProfile | Accepted |
| ADR-007 | API `/api/v2/auth` | Versioned Website auth | Accepted |
| ADR-008 | Soft-delete IdentityLink | Forensic history | Accepted |
| ADR-009 | Max 10 sessions | Evict oldest | Accepted |
| ADR-010 | RBAC tables | Not roles-on-User | Accepted |
| ADR-011 | RiskEngine separate + MONITOR geo | No auto geo logout early | Accepted |
| ADR-012 | Domain Event Bus | Side effects outside Auth | Accepted |
| ADR-013 | MFA schema stubs only | No MFA runtime yet | Accepted |
| ADR-014 | Immutable AuthAuditLog | Never delete | Accepted |
| ADR-015 | Same-origin `onix.gg/api` | Prefer over split subdomains | Accepted |
| ADR-016 | IdP roadmap Email before Google | Recovery independence | Accepted |
| ADR-017 | No ADMIN_LOGIN_AS_USER in MVP | Too dangerous early | Accepted |
| ADR-018 | TrustedDevice entity | Risk/MFA remember | Accepted |
| ADR-019 | IdentityHistory ledger | IdP lifecycle forensics | Accepted |
| ADR-020 | Refresh family + reuse revoke | Theft containment | Accepted |
| ADR-021 | Ed25519 access JWT + kid | Not HS256 for v2 web | Accepted |
| ADR-022 | SigningKey current/previous | Rotate without mass logout | Accepted |
| ADR-023 | SecretsProvider ENV→KMS | Portable secrets | Accepted |
| ADR-024 | permissionVersion + cache | Not full perms in JWT | Accepted |
| ADR-025 | Atomic refresh CAS | Tab race ≠ theft by default path | Accepted |
| ADR-026 | Explicit Account Merge | No silent merge | Accepted |
| ADR-027 | Security notify via events | Auth does not send mail | Accepted |
| ADR-028 | Idle 14d / Absolute 90d / Access 15m | Session lifetime policy | Accepted |
| ADR-029 | Stable `AUTH_*` error codes | Frontend contract | Accepted |
| ADR-030 | Observability baseline | requestId, metrics, traces | Accepted |
| ADR-031 | Transaction boundaries | Login TX atomic; events after commit | Accepted |
| ADR-032 | Auth idempotency | Callback/refresh safe retries | Accepted |
| ADR-033 | JWT clock skew ±30s | exp/iat/nbf tolerance | Accepted |
| ADR-034 | Neon backup RPO/RTO | Backup & restore targets | Accepted |
| ADR-035 | Feature flag USE_NEW_AUTH | Gradual Website v2 rollout | Accepted |
| ADR-036 | Phase rollback plans | Especially Phase 3 Website cutover | Accepted |
| ADR-037 | Authorization Boundary | AuthN → PermissionResolver → Policy → Biz | Accepted |
| ADR-038 | Versioned domain events | `EventName.v1` contract | Accepted |
| ADR-039 | LockProvider portability | Memory → Redis → PG advisory | Accepted |
| ADR-040 | HTTP Idempotency-Key | Header + TTL store + cleanup | Accepted |
| ADR-041 | Background job backbone | Decide adapter; default Postgres/BullMQ path | Accepted |
| ADR-042 | API compatibility | `/api/v2` non-breaking; break in `/v3` | Accepted |
| ADR-043 | Deprecation policy | Deprecated → Sunset → Removed | Accepted |
| ADR-044 | Auth rate-limit defaults | Login/Refresh/Callback/Admin budgets | Accepted |

---

## 23. Phase 1 readiness declaration

### Critical architectural issues remaining?

**None.** Operational prep: `ONIX-AUTH-PHASE-RUNBOOK.md`. Stripe-tier ADRs 037–044 are non-blocking.

### Phase 1 scope (only)

Prisma schema + migration + IdentityLink/Session/Audit(+related additive tables) + backfill + dual-write + tests.  
**Out of Phase 1:** Frontend, AuthManager, cookies, refresh API, Website cutover.

### Go statement

**Yes — Phase 1 only** (database layer). Implementation follows the Runbook.

---

## 24. Operational ADRs (031–036)

### ADR-031 — Transaction Boundaries

**Single DB transaction** for successful Website login / IdP callback persistence:

```
BEGIN
  upsert/find User
  upsert IdentityLink (active)
  insert Session
  insert AuthAuditLog (LOGIN_SUCCESS)
  insert IdentityHistory (LINKED if new)
COMMIT
THEN publish Domain Events (UserLoggedIn.v1, SessionCreated.v1, …)
```

Rules: events only after COMMIT; refresh = atomic CAS + audit in one TX; RiskEngine has no external side effects inside TX.

### ADR-032 — Idempotency (auth operations)

| Operation | Rule |
| --- | --- |
| IdP callback | Unique `(provider, providerUserId)` → no second User |
| Refresh | CAS on `refreshTokenHash` |
| Backfill | `ON CONFLICT DO NOTHING` |

### ADR-033 — Clock Skew

`JWT_CLOCK_SKEW_SECONDS=30` on `exp` / `iat` / `nbf`.

### ADR-034 — Neon Backup

RPO ≤ 5 min · RTO ≤ 1 h · named snapshot before each phase migration · restore drill before Phase 3.

### ADR-035 — Feature Flags

`USE_NEW_AUTH` (default false) · `AUTH_DUAL_WRITE_IDENTITY` (default true) · `AUTH_ENFORCE_IDENTITY_LINK` (Phase 4).

### ADR-036 — Rollback

Phase 1: disable dual-write / restore snapshot. Phase 3: `USE_NEW_AUTH=false`.

---

## 25. Stripe-tier ADRs (037–044) — non-blocking

### ADR-037 — Authorization Boundary

```
Authentication (who)
  → PermissionResolver (what permissions; uses pv + cache)
  → MarketplacePolicy (resource rules: order ownership, escrow state…)
  → Business Logic
```

**Forbidden:** scattering `if (user.isAdmin)` across modules. `isAdmin` is a temporary compat shim seeding RBAC only. New code uses `@RequirePermission('…')` / policy services (Phase 2+).

### ADR-038 — Versioned Domain Events

Event type strings **must** include a version suffix: `UserLoggedIn.v1`, `IdentityLinked.v1`, `SessionRevoked.v1`, `RefreshReuseDetected.v1`. Breaking payload changes → `.v2` with dual-publish window; never silently change `.v1` schema.

### ADR-039 — LockProvider

Interface `LockProvider.acquire(key, ttl)`. Adapters: **Memory** (dev/single node) → **Redis** (multi-node) → **Postgres advisory locks** (fallback). Auth refresh single-flight may use LockProvider when multi-instance (Phase 2+). No Redis required for Phase 1.

### ADR-040 — HTTP Idempotency-Key

For mutating auth/marketplace POSTs that need client retries:

- Header: `Idempotency-Key` (UUID/cuid, max 128)  
- Storage: `IdempotencyRecord{ key, userId?, route, requestHash, responseCode, responseBody, expiresAt }`  
- TTL: default **24h**  
- Cleanup: scheduled job deletes `expiresAt < now`  
- Same key + different body → `409 IDEMPOTENCY_KEY_REUSE_MISMATCH`

Phase 1: table only. Wire in Phase 2+ endpoints as needed.

### ADR-041 — Background Jobs

Domain Event Bus ≠ durable queue. Choose one backbone behind `JobQueue` port:

| Option | Fit |
| --- | --- |
| **BullMQ (Redis)** | Good default when Redis arrives for locks/cache |
| **Postgres SKIP LOCKED queue** | Fine before Redis; operationally simple |
| **Temporal** | Overkill until complex multi-step merge/payout workflows |
| **NATS JetStream** | If already in stack |

**Decision for ONIX:** start with **Postgres queue** (Phase 2 notifications/backfill) → migrate to **BullMQ** when Redis is introduced for cache/locks. Temporal reserved for escrow state machines later if needed. Auth must not embed a specific vendor.

### ADR-042 — API Compatibility Policy

- `/api/v2/*` is **additive-compatible**: no breaking response/field removals, no meaning changes.  
- Breaking changes only in `/api/v3/*` (or later).  
- Legacy `/api/auth/telegram-mini` frozen by Mini App constraint (exception to versioning).  
- Additive optional fields allowed in v2 with documented defaults.

### ADR-043 — Deprecation Policy

```
Active → Deprecated (documented + Warning/Sunset headers)
      → Sunset date announced (≥ 90 days for external clients)
      → Removed
```

Example: `/api/auth/telegram-login` after Website v2 soak. Metrics gate before remove. Mini App endpoint is **not** deprecated under current constraint.

### ADR-044 — Auth Rate Limit Defaults

| Endpoint class | Default budget |
| --- | --- |
| Login / IdP callback | **5 / min / IP** and **5 / min / providerUserId** |
| Refresh | **60 / min / session** and **120 / min / IP** |
| Logout | **30 / min / user** |
| Admin auth-sensitive | **30 / min / admin user** |

Exceed → `429 AUTH_RATE_LIMITED` + SecurityEvent when abusive. Tunable via config; values are starting defaults not sacred.

### Optional “Enterprise Enterprise” (explicitly deferred)

Chaos testing, full STRIDE threat model docs, abuse-case catalogues, sequence-failure diagrams, DR game days — valuable later; **not** required to start Phase 1.

---

# Architecture is ready for Phase 1 implementation.

Phase 1 execution: **`docs/architecture/ONIX-AUTH-PHASE-RUNBOOK.md`**.

---

*End of ONIX-AUTH-ADD v1.4 (+ ADRs 037–044) — Phase 1 implementation tracked separately.*
