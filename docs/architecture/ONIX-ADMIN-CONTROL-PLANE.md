# ONIX Admin Control Plane (Slice 6)

Separate **admin control plane**: own auth (`AdminUser` / `AdminSession` / MFA), own JWT (`typ=admin_access`, `aud=onix-admin`), and a dedicated SPA at **`/admin/`**.

Customer Profile **ADMIN** opens that app — it is not a tab inside the marketplace SPA.

## Apps

| Surface | Path | Auth |
|---------|------|------|
| Customer marketplace | `/` | Customer JWT (`aud=onix-web`) |
| Security Ops Console | `/admin/` | Admin JWT + `__Host-onix_admin_rt` |

## Bootstrap

When `AdminUser` table is empty:

```env
ADMIN_BOOTSTRAP_EMAIL=ops@example.com
ADMIN_BOOTSTRAP_PASSWORD=at-least-12-chars
ADMIN_BOOTSTRAP_TELEGRAM_ID=123456789
# Local only; production sends the code through BOT_TOKEN:
ADMIN_MFA_DEBUG=true
```

Optional: `ADMIN_IP_ALLOWLIST` on admin auth + legacy customer-admin ops.

## Auth API

```http
POST /api/admin/auth/login     { email, password } → { mfaRequired, challengeId, debugCode? }
POST /api/admin/auth/mfa       { challengeId, code } → { accessToken, admin } + refresh cookie
POST /api/admin/auth/refresh   refresh cookie → rotated cookie + new accessToken
POST /api/admin/auth/logout
GET  /api/admin/auth/me
GET  /api/admin/me
```

Customer tokens are rejected (`AdminAccessGuard`).

## Security Ops APIs

```http
GET /api/admin/dashboard
GET /api/admin/security-flags
GET /api/admin/users/:id
GET /api/admin/withdrawals
GET /api/admin/risk/events
```

All require admin access token. Security/risk routes require `SECURITY_ADMIN`,
withdrawals require `FINANCE_ADMIN` or `SECURITY_ADMIN`, and investigations also
allow `SUPPORT_ADMIN`; `SUPER_ADMIN` can access all. Actions are written to
`AdminActionLog`.

## Legacy customer-admin routes

`POST /api/admin/users/.../ban|status|balance|sell-ban` and product moderation still use **customer** admin JWT (`isAdmin`). They remain for marketplace staff until migrated into this plane.

## Local dev

```bash
npm run start:dev
npm run dev --prefix onix-admin   # http://localhost:5174/admin/ (proxies /api)
```

Prod build: `npm run build:web` syncs customer → `public/spa` and admin → `public/spa/admin`.

## Threat model notes

- Separate cookies / JWT audience from customer plane
- Allowlist is defense-in-depth, not a substitute for MFA
- YELLOW flags are review signals; staff decide manually
