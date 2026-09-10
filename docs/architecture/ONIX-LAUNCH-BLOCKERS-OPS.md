# Launch blockers — ops checklist (must execute)

Code on `v2.0.4` hardens what can be hardened in-app. The items below are **manual** and still block a confident money launch until done.

## 1. Origin / firewall (BLOCK)

Grey-cloud Cloudflare means browsers and attackers hit the Amvera IP directly.
App middleware rejects **literal-IP `Host`** and hosts outside `ALLOWED_HOSTS`.
That does **not** stop `https://IP` with `Host: www.onixtg.shop`.

**Do this:**

1. Amvera panel → restrict ingress / ask support for IP allowlisting if available.
2. Set env on Amvera:
   - `ALLOWED_HOSTS=www.onixtg.shop,onixtg.shop`
   - `AMVERA=1`
   - Optional later edge: `ORIGIN_EDGE_SECRET=<random>` + header `X-ONIX-Edge-Secret`
3. After deploy verify:
   - `curl -k https://<ingress-ip>/api/health/live -H "Host: <ingress-ip>"` → **421**
   - `curl https://www.onixtg.shop/api/health/live` → **200**
4. Never enable Cloudflare Proxied (orange) on `@`/`www` (RU TLS RST).

## 2. Backup / restore drill (BLOCK)

```powershell
$env:RESTORE_DATABASE_URL = "postgresql://...scratch-direct.../neondb?sslmode=require"
npm run ops:backup-drill -- diagnose
npm run ops:backup-drill -- diagnose-restore
npm run ops:backup-drill -- verify
```

Save redacted JSON under local `ops-drills/` (gitignored) or attach to the ship ticket.
Assert restore OK and no duplicate ledger idempotency after restore.

## 3. Realtime restart drill (ACCEPT with evidence)

1. Open a DISPUTE chat on www.
2. Restart Amvera API mid-thread.
3. Expect WS drop; within ≤15s HTTP poll reloads messages; order status via HTTP.
4. Confirm `REDIS_URL` is set in Amvera.

## 4. Clawback collector (code + ops)

When post-complete refund cannot debit full payout:

1. `OrderClawback` OPEN/PARTIAL (no negative balance).
2. Buyer still refunded in full (platform float).
3. Seller `withdrawBlockedAt` + `SecurityEvent` `CLAWBACK_DEBT`.
4. Further withdraw blocked until recovered/waived.
5. Admin: openClawbacks → investigate → waive only with written reason.

## 5. Money concurrency

Model/source races covered in `safe-deal-platform/test/launch-blockers-money.test.ts`.
Optional: on Neon scratch, two parallel purchases qty=1 → one 409.
