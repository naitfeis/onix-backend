# ONIX — production ops (Amvera Moscow)

| Field | Value |
| --- | --- |
| **Updated** | **2026-09-10** |
| **Canonical site** | `https://www.onixtg.shop` (SPA + API, same origin) |
| **Public compute** | Amvera Cloud **msk0**, project `api-onix`, user `naitfeis222112` |
| **Ingress A** | `158.160.116.199` |
| **Staging** | Render `https://onix-api-47tj.onrender.com` (do not point `www` here) |
| **DB** | Neon `eu-central-1` (Frankfurt) — no RU region |
| **Redis** | Render Key Value (Valkey) **external** `rediss://` — internal hostname does not resolve from Amvera |
| **Git daily** | `v2.0.4` |
| **Git Amvera ship** | **`v2.0.4-amvera`** (Amvera panel must track this; old `v1.3-amvera` / `v2.0.3-amvera` will not get v2.0.4 code) |

**Decisions & money-launch gates:** `docs/architecture/ONIX-CURRENT-STATE-v2.0.4.md`  
**AI context:** `docs/Documentation/Onix-Notes.md` §0.1  
Code wins if docs disagree.

---

## Browser path (must stay true)

```
User in RU
  → https://www.onixtg.shop   (DNS only / grey cloud at Cloudflare)
  → Amvera ingress 158.160.116.199
  → Nest on :3000 (SPA from public/spa + /api)

Telegram
  → POST https://www.onixtg.shop/api/telegram/webhook
  → same Nest
```

Do **not**:

- Cloudflare **proxy** (orange cloud) on `@` or `www` — RU ISPs RST Cloudflare; Amvera cert issuance also fails.
- Extra **AAAA** on `@` / `www`.
- Browser `VITE_API_URL` pointing at Render or `api.onixtg.shop`.
- Work from apex `https://onixtg.shop` for login — `__Host-` cookies are host-only (`www` ≠ apex).
- Type bare `/start` in the bot. Login needs `t.me/<bot>?start=login_<challengeId>` from the website button. Challenge TTL is 2 minutes. Keep the website tab open.

Amvera env vars are **runtime only** (not available at `npm run build`). `VITE_*` in the Amvera panel does **not** bake into an already-built SPA.

---

## DNS (Cloudflare, DNS only)

| Name | Type | Content |
| --- | --- | --- |
| `@` | A | `158.160.116.199` |
| `www` | A | `158.160.116.199` |
| `@` | TXT | `naitfeis222112-api-onix` (Amvera verify; keep SPF TXT too) |
| `www` | TXT | `naitfeis222112-api-onix` (required to attach `www` as a second hostname) |

Mail/ftp/MX/SPF to reg.ru stay. Delete CNAME `www`/`api` → onrender.com after cutover.

Each Amvera custom hostname needs its own TXT on **that** name. Apex TXT is not used for `www`.

SSL: Let's Encrypt per hostname after attach. Until `www` is attached, Kubernetes fake cert + HSTS (`max-age=31536000; includeSubDomains` from the app) blocks Edge (`ERR_CERT_AUTHORITY_INVALID`).

---

## Git / Amvera config

| Item | Notes |
| --- | --- |
| Ship branch | **`v2.0.4-amvera`** — see `AMVERA-SHIP-v2.0.4.md` |
| `amvera.yaml` / `amvera.yml` | Node 22; build `npm ci --include=dev && npm run build && npm run build:spa`; **no migrate at build** |
| `scripts/start-amvera.mjs` | dotenv → require `DATABASE_URL` → `prisma migrate deploy` → `node dist/main.js` |
| Listen | `0.0.0.0:3000` |
| Empty Amvera Configuration form | Do not Apply empty dropdowns — overwrites yaml |
| Replicas | Keep **1** while `www` points at this project |

If Amvera «не подхватывает» обновления — проверьте, что Git branch в панели = `v2.0.4-amvera`, не старая `*-amvera`.

---

## Required env for v2.0.4+ boot

| Name | Required | Notes |
| --- | --- | --- |
| `AMVERA` | yes | `1` |
| `ALLOWED_HOSTS` | yes | `www.onixtg.shop,onixtg.shop` |
| `ORIGIN_GREY_CLOUD_ACK` | yes* | `grey-cloud-accepted` — *or* set `ORIGIN_EDGE_SECRET` |
| `ALERT_WEBHOOK_URL` | recommended | Slack Incoming Webhook; free; paging for clawback/dispute/recon |
| `DATABASE_URL` | yes | Neon |
| `TELEGRAM_WEBHOOK_SECRET` | yes | must match setWebhook |
| `BOT_TOKEN` | yes | not `TELEGRAM_BOT_TOKEN` |
| `GOOGLE_CLIENT_ID` | yes for Google login | no Client Secret |
| `REDIS_URL` | yes for multi/realtime | external Valkey |

Missing ACK/edge secret → log `[FATAL] Origin launch gate` and crash loop (seen 2026-09-10).

---

## Auth ops

| Concern | Fact |
| --- | --- |
| Website login | Telegram bot LoginChallenge (not Widget) |
| Webhook | `POST /api/telegram/webhook` only. GET in a browser is 404 and is not a test |
| Replay | Durable `update_id` via `IdempotencyRecord` scope `telegram:webhook` (7d TTL) |
| Secret | `TELEGRAM_WEBHOOK_SECRET` on Amvera must match `secret_token` in `setWebhook` |
| Bot token | `BOT_TOKEN` (not `TELEGRAM_BOT_TOKEN`) |
| Google | Runtime `GOOGLE_CLIENT_ID` only. SPA: `GET /api/v2/auth/public-config`. **No Client Secret.** JS origins: `https://www.onixtg.shop`, `https://onixtg.shop`. Redirect URI: `https://www.onixtg.shop/api/v2/auth/google/callback` (и apex, если ещё не 301). |
| Google sell | Google users cannot sell until Telegram is linked |
| Cookies | `__Host-onix_rt`, `__Host-onix_ls` — Secure, Path=/, no Domain |
| Ed25519 rotate | `npm run auth:rotate-ed25519` — see `ONIX-KEY-ROTATION-RUNBOOK.md` |

Set webhook (PowerShell, not cmd `%BOT%`):

```powershell
curl.exe "https://api.telegram.org/bot${bot}/setWebhook" `
  -d "url=https://www.onixtg.shop/api/telegram/webhook" `
  -d "secret_token=${secret}"
```

`getWebhookInfo.url` must be that URL; `ip_address` should be `158.160.116.199`.

---

## Slack alerts (2026-09-10)

1. api.slack.com → Create App → **Blank app** (not AI / Starter / CLI).
2. Incoming Webhooks → On → Add to workspace → channel or your DM.
3. Copy Webhook URL → Amvera `ALERT_WEBHOOK_URL` (secret).
4. Test (PowerShell):

```powershell
$body = @{ text = "ONIX alert test" } | ConvertTo-Json
Invoke-RestMethod -Method Post -ContentType "application/json" -Body $body -Uri $env:ALERT_WEBHOOK_URL
```

Expect `ok`. Rotate URL if it was pasted into chats.

---

## R2 (chat attachments)

Cloudflare R2 is S3-compatible object storage for **chat files**, not the SPA.

Env (Amvera runtime): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Optional `R2_ENDPOINT`.

Without them, upload returns «Загрузка файлов временно недоступна».

Browser **PUT** goes to `*.r2.cloudflarestorage.com` (Cloudflare). From Russia this can fail the same way orange-cloud sites fail. Server-side Amvera→R2 is a later change if needed.

---

## Latency / RU

Typical catalog/health on `www`: ~200–300 ms. Neon + Redis stay in Frankfurt (+20–50 ms per hop). Amvera 0.5 CPU / 1 GB can hitch under burst. Google GIS (`accounts.google.com`) may be slow or blocked in RU independently of Amvera.

Local `npx prisma migrate status` may show **P1001** if the laptop cannot reach Neon (VPN/ISP/paused project). Amvera↔Neon often still works; fix laptop network or use Neon Direct from a reachable network for drills.

---

## Security (Amvera)

- Do **not** set `TRUST_CDN_HEADERS=true` unless Cloudflare orange is on (it should not be). Spoofed `CF-Connecting-IP` would skip rate limits.
- `TELEGRAM_WEBHOOK_SECRET` is required in production. Rotate anything pasted in chats.
- Render Valkey `0.0.0.0/0` is a standing risk if `REDIS_URL` leaks.
- Remaining list: `docs/Documentation/Onix-Notes.md` §0.2.
- **Origin guard (v2.0.4+):** rejects literal-IP `Host` / unknown hosts; bootstrap requires `ORIGIN_GREY_CLOUD_ACK` or `ORIGIN_EDGE_SECRET`. Probe: `npm run ops:origin-probe`.
- **Dispute SLA worker** + clawback/float paging need worker process + `ALERT_WEBHOOK_URL`.
- Ops checklist: `docs/architecture/ONIX-LAUNCH-BLOCKERS-OPS.md`.

---

## DDoS / WAF / Cloudflare (2026-09)

**Не включайте оранжевое облако (Proxied) на `@` и `www`.** Российские сети рвут TLS до Cloudflare; сайт и вход перестанут открываться. DNS-only (серое облако) оставляем.

| Слой | Как |
| --- | --- |
| Код | Host allowlist + grey-cloud ACK / edge secret; ~240 req/мин `/api`; JSON ≤ 128kb; WS Origin в production |
| Amvera | Одна реплика; L3/L4 — тикет Amvera |
| Cloudflare | Только DNS-only. WAF на orange **нельзя** для RU |
| Redis | Не `0.0.0.0/0` |
| Alerts | Slack Incoming Webhook → `ALERT_WEBHOOK_URL` |

**Allowlist админки:** админка → Сотрудники → «ваш IP» → `ADMIN_IP_ALLOWLIST=…` → рестарт.

**Модераторы:** роль `SUPPORT_ADMIN` в `/admin/` (не аккаунт маркета).

`ADMIN_IP_RESUME` по умолчанию выключен.

---

## Related

- Current decisions: `ONIX-CURRENT-STATE-v2.0.4.md`
- Ship: `AMVERA-SHIP-v2.0.4.md`
- Launch blockers: `ONIX-LAUNCH-BLOCKERS-OPS.md`
- Key rotation: `ONIX-KEY-ROTATION-RUNBOOK.md`
- Bot login diagnostics: `ONIX-TELEGRAM-BOT-CHAIN-BREAK.md`
- Attachments: `ONIX-CHAT-ATTACHMENTS-V1.md`
- Historical cutover (wrong as of 2026-09): `ONIX-SINGLE-ORIGIN-MIGRATION.md`
