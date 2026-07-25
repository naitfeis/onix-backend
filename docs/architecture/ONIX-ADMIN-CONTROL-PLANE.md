# ONIX Admin Control Plane (Slice 6)

First cut of a **logical** admin control plane on the existing API host.  
A separate `admin.onix.gg` SPA is a later follow-up — not required for this slice.

## Goals

1. Expose **security-review flags** (YELLOW) derived from ledger provenance — no `FinancialAuditEvent` table.
2. Harden dangerous `/api/admin/*` (and support refund) paths with optional **IP allowlist**.
3. Keep RBAC: `isAdmin` / `canActAsSupport` / SUPER_ADMIN rules unchanged.

## Non-goals (this slice)

- Separate admin frontend host / DNS cutover
- Full security case management UI
- Auto-ban from YELLOW flags (YELLOW ≠ fraud)
- Vault/KMS (Slice 5 hygiene remains ENV)

## Security flags

| Code | Severity | Meaning |
|------|----------|---------|
| `ACCOUNT_SALE_FUNDS_UNDER_PROTECTION` | `YELLOW` | New account (&lt;7d) still holds restricted ACCOUNT sale proceeds |

Source of truth: `WithdrawVelocityService.resolveAccountSaleProtectionFlag` (User + LedgerEntry).

### API

```http
GET /api/admin/users/:onixId/security-flags
Authorization: Bearer <admin access>
```

Response:

```json
{
  "onixId": "ONIX-7",
  "userId": "7",
  "flags": [
    {
      "code": "ACCOUNT_SALE_FUNDS_UNDER_PROTECTION",
      "severity": "YELLOW",
      "userId": "7",
      "accountAgeDays": 2,
      "restrictedAccountSaleCents": "2000000",
      "protectionUntil": "2026-08-01T00:00:00.000Z"
    }
  ]
}
```

Empty `flags` = no active review signals.

## IP allowlist

| Env | Meaning |
|-----|---------|
| `ADMIN_IP_ALLOWLIST` | Comma-separated client IPs (after CDN resolution). Empty = **not enforced** (local/dev). |

When non-empty, `resolveClientIp` must match an entry or the request gets **403**.

Applies to:

- `AdminGuard` routes (`/api/admin/users/...` balance, ban, status, sell-ban, security-flags)
- `SupportGuard` ops refund/complete under `/api/support` and `/api/admin/orders/.../refund`

Production recommendation: set allowlist to office/VPN egress IPs. Startup inventory reports the env as optional (`present` / `missing`).

## Threat model notes

- Allowlist is defense-in-depth on top of session RBAC — not a substitute for MFA/session revoke.
- Client-supplied `device.ipAddress` is never trusted (existing `resolveClientIp`).
- YELLOW flags are **review signals**; staff decide manually.

## Follow-ups

- Dedicated `admin.onix.gg` origin + stricter cookie/CORS
- Step-up MFA on balance adjust / ban
- Queue of all YELLOW users (batch scan) for ops dashboards
