# Amvera ship note — v2.0.4

| | |
| --- | --- |
| **Updated** | **2026-09-10** |
| **Deploy branch (Amvera Git)** | **`v2.0.4-amvera`** |
| **Dev line** | `v2.0.4` |
| **Orient commit** | `692678b` |

## Before first start on this line

Amvera env (runtime / «Запуск»):

```text
AMVERA=1
ALLOWED_HOSTS=www.onixtg.shop,onixtg.shop
ORIGIN_GREY_CLOUD_ACK=grey-cloud-accepted
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/...   # optional but recommended
```

Without `ORIGIN_GREY_CLOUD_ACK` (or `ORIGIN_EDGE_SECRET`) the process **exits FATAL** at bootstrap (`Origin launch gate`).

## What this ship includes (high level)

- Origin launch gate + Host/SNI policy; health bypass fail-closed for literal-IP Host
- Durable Telegram `update_id` idempotency; Wallet hard-gate comment
- Ed25519 `auth:rotate-ed25519` + retire TTL guard
- Dispute SLA worker (`DISPUTE_SLA_BREACH`)
- Clawback / platform-float alert paging via `ALERT_WEBHOOK_URL`
- Ops: `ops:origin-probe`, `ops:db-concurrency-drill`, backup evidence archive
- Fee + partial clawback conservation tests

Runtime still runs `prisma migrate deploy` via `scripts/start-amvera.mjs`.

## After switching branch in Amvera

1. Set env above → Save  
2. Git branch = `v2.0.4-amvera` → redeploy  
3. Confirm logs: no `Origin launch gate`; migrate OK  
4. Smoke: `https://www.onixtg.shop/api/health/live`

Full decisions: `docs/architecture/ONIX-CURRENT-STATE-v2.0.4.md`.
