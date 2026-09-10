# Launch blockers — ops checklist (must execute)

| | |
| --- | --- |
| **Updated** | **2026-09-10** |
| **Full decisions** | `ONIX-CURRENT-STATE-v2.0.4.md` |

Code hardens what can be hardened in-app. Items below need **evidence files** under
`ops-drills/` (gitignored) and/or `docs/architecture/ops-evidence/` (committable redacted).

## 0. Amvera ship (do first)

1. Env: `AMVERA=1`, `ALLOWED_HOSTS=www.onixtg.shop,onixtg.shop`, `ORIGIN_GREY_CLOUD_ACK=grey-cloud-accepted`
2. Env: `ALERT_WEBHOOK_URL` (Slack Incoming Webhook — Blank app, not CLI)
3. Git branch in Amvera panel = **`v2.0.4-amvera`** → redeploy
4. Logs: no `Origin launch gate`; migrate OK; health 200 on www

## 1. Origin / firewall

### Live truth (2026-09-10 probe)

| Probe | Result |
| --- | --- |
| `Host: <ingress-ip>` → `/api/health/live` | **404** (CLOSED for literal-IP Host) |
| `https://<ip>` + `Host: www.onixtg.shop` | **200/401** (DNS-equivalent on grey-cloud) |
| `https://www.onixtg.shop/api/health/live` | **200** |

Grey-cloud means Cloudflare WAF is **not on-path**. Raw IP + `Host: www` is the same entry as DNS A→IP.
That is **not** a Host-guard bug; closing it requires an edge + `ORIGIN_EDGE_SECRET` + Amvera allowlist.

### App gates (v2.0.4+)

1. Amvera env as in §0.
2. Bootstrap **fails** in production without edge secret or grey-cloud ACK.
3. Re-probe and archive:

```powershell
npm run ops:origin-probe
# writes ops-drills/origin-probe-*.json + docs/architecture/ops-evidence/origin-probe-latest.json
```

Money-launch status:
- `CLOSED` → PASS
- `OPEN_GREY_CLOUD_DNS_EQUIVALENT` + `ORIGIN_GREY_CLOUD_ACK` → PASS_WITH_ACK
- literal-IP Host still 200 → **FAIL / BLOCK**

Never enable Cloudflare Proxied (orange) on `@`/`www` (RU TLS RST).

## 2. Backup / restore drill (BLOCK until verify OK)

```powershell
npm run ops:backup-drill -- check
npm run ops:backup-drill -- diagnose
npm run ops:backup-drill -- diagnose-restore
# RESTORE_DATABASE_URL must be Neon **direct** (no -pooler), scratch branch ≠ prod
npm run ops:backup-drill -- backup
npm run ops:backup-drill -- verify
```

Current blocker if restore host contains `-pooler`: set a Direct connection string from Neon console.
Laptop **P1001** = cannot reach Neon from your network — resume Neon / fix VPN / try another network; Amvera may still migrate fine.

Save JSON under `ops-drills/` and copy a redacted summary to `docs/architecture/ops-evidence/backup-drill-latest.json`.

## 3. DB-backed concurrency (explicit answer)

| Suite | Backend |
| --- | --- |
| `test/launch-blockers-money.test.ts`, `ledger-property`, `monetary-invariants.e2e` | **In-memory `LedgerModel`** — invariant logic, not Postgres races |
| `product-stock.ts` | Real DB primitive: `updateMany` + `quantity: { gte }` |
| `npm run ops:db-concurrency-drill` | **Real Postgres** two-client `UPDATE … WHERE quantity >= 1` |

```powershell
$env:CONCURRENCY_DRILL_DATABASE_URL = "postgresql://…scratch-direct…/neondb?sslmode=require"
npm run ops:db-concurrency-drill
```

Until that drill archives `ok: true`, GAP #2 (DB race) remains open for money launch.

## 4. Realtime restart drill (ACCEPT with evidence)

1. Open a DISPUTE chat on www.
2. Restart Amvera API mid-thread.
3. Expect WS drop; within ≤15s HTTP poll reloads messages; order status via HTTP.
4. Confirm `REDIS_URL` is set in Amvera.

## 5. Dispute SLA (code)

Worker job `dispute-sla` (default every 5m):
- Finds `Order.status=DISPUTE` older than `DISPUTE_SLA_DAYS` (default 7)
- Creates `SecurityEvent` `DISPUTE_SLA_BREACH`
- Bumps open tickets to `CRITICAL`
- Pages via `AlertingService` / `ALERT_WEBHOOK_URL`

Does **not** auto-refund — human policy.

## 6. Money alerts

Set on Amvera **and** worker:

- `ALERT_WEBHOOK_URL` (Slack/Discord/PagerDuty JSON) — **free** Slack Incoming Webhook
- Optional: `ERROR_WEBHOOK_URL`, `CLAWBACK_ALERT_MIN_CENTS`, `CLAWBACK_ALERT_AGE_HOURS`

Wired rules: clawback open debt gauges, platform float proxy, dispute SLA, reconciliation mismatch,
idempotency conflicts (threshold 10/min). Without webhook URL, alerts only structured-log (startup warns).

Slack setup: Blank app → Incoming Webhooks → Add → copy URL. Not Slack CLI / Bolt / AI agent.
Test: PowerShell `ConvertTo-Json` + `Invoke-RestMethod` (curl JSON escaping often breaks on Windows).

## 7. Clawback collector (code + ops)

When post-complete refund cannot debit full payout:

1. `OrderClawback` OPEN/PARTIAL (no negative balance).
2. Buyer still refunded in full (platform float).
3. Seller `withdrawBlockedAt` + `SecurityEvent` `CLAWBACK_DEBT`.
4. Further withdraw blocked until recovered/waived.
5. Admin: openClawbacks → investigate → waive only with written reason.
