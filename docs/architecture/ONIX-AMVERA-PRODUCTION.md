# ONIX — production ops (Amvera Moscow)

| Field | Value |
| --- | --- |
| **As of** | 2026-09-01 |
| **Canonical site** | `https://www.onixtg.shop` (SPA + API, same origin) |
| **Public compute** | Amvera Cloud **msk0**, project `api-onix`, user `naitfeis222112` |
| **Ingress A** | `158.160.116.199` |
| **Staging** | Render `https://onix-api-47tj.onrender.com` (do not point `www` here) |
| **DB** | Neon `eu-central-1` (Frankfurt) — no RU region |
| **Redis** | Render Key Value (Valkey) **external** `rediss://` URL — internal hostname does not resolve from Amvera |
| **Git deploy branch** | `v1.3-amvera` (Amvera GitHub). Daily work: `v1.3`. Ship Moscow: merge `v1.3` → `v1.3-amvera` → push |

AI context: `docs/Documentation/Onix-Notes.md` §0.1 and this file. Code wins if they disagree.

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
| `amvera.yaml` / `amvera.yml` | Node 22; build `npm ci --include=dev && npm run build && npm run build:spa`; **no migrate at build** |
| `scripts/start-amvera.mjs` | dotenv → require `DATABASE_URL` → `prisma migrate deploy` → `node dist/main.js` |
| Listen | `0.0.0.0:3000` |
| Empty Amvera Configuration form | Do not Apply empty dropdowns — overwrites yaml |
| Replicas | Keep **1** while `www` points at this project |

---

## Auth ops

| Concern | Fact |
| --- | --- |
| Website login | Telegram bot LoginChallenge (not Widget) |
| Webhook | `POST /api/telegram/webhook` only. GET in a browser is 404 and is not a test |
| Secret | `TELEGRAM_WEBHOOK_SECRET` on Amvera must match `secret_token` in `setWebhook` |
| Bot token | `BOT_TOKEN` (not `TELEGRAM_BOT_TOKEN`) |
| Google | Runtime `GOOGLE_CLIENT_ID` only. SPA: `GET /api/v2/auth/public-config`. **No Client Secret.** JS origins: `https://www.onixtg.shop`, `https://onixtg.shop`. Redirect URI: `https://www.onixtg.shop/api/v2/auth/google/callback` (и apex, если ещё не 301). |
| Google sell | Google users cannot sell until Telegram is linked |
| Cookies | `__Host-onix_rt`, `__Host-onix_ls` — Secure, Path=/, no Domain |

Set webhook (PowerShell, not cmd `%BOT%`):

```powershell
curl.exe "https://api.telegram.org/bot${bot}/setWebhook" `
  -d "url=https://www.onixtg.shop/api/telegram/webhook" `
  -d "secret_token=${secret}"
```

`getWebhookInfo.url` must be that URL; `ip_address` should be `158.160.116.199`.

---

## R2 (chat attachments)

Cloudflare R2 is S3-compatible object storage for **chat files**, not the SPA.

Env (Amvera runtime): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Optional `R2_ENDPOINT`.

Without them, upload returns «Загрузка файлов временно недоступна».

Browser **PUT** goes to `*.r2.cloudflarestorage.com` (Cloudflare). From Russia this can fail the same way orange-cloud sites fail. Server-side Amvera→R2 is a later change if needed.

---

## Latency / RU

Typical catalog/health on `www`: ~200–300 ms. Neon + Redis stay in Frankfurt (+20–50 ms per hop). Amvera 0.5 CPU / 1 GB can hitch under burst. Google GIS (`accounts.google.com`) may be slow or blocked in RU independently of Amvera.

## Security (Amvera)

- Do **not** set `TRUST_CDN_HEADERS=true` unless Cloudflare orange is on (it should not be). Spoofed `CF-Connecting-IP` would skip rate limits.
- `TELEGRAM_WEBHOOK_SECRET` is required in production. Rotate anything pasted in chats.
- Render Valkey `0.0.0.0/0` is a standing risk if `REDIS_URL` leaks.
- Remaining list: `docs/Documentation/Onix-Notes.md` §0.2.
- **Origin guard (v2.0.4+):** production rejects literal-IP `Host` and hosts outside `ALLOWED_HOSTS`. Set `ALLOWED_HOSTS=www.onixtg.shop,onixtg.shop`. Bootstrap requires **either** `ORIGIN_EDGE_SECRET` **or** `ORIGIN_GREY_CLOUD_ACK=grey-cloud-accepted` (grey-cloud = public IP is DNS-equivalent; CF WAF not on-path). Re-probe: `npm run ops:origin-probe`. This does **not** replace an Amvera network allowlist for L3/L4 — see `docs/architecture/ONIX-LAUNCH-BLOCKERS-OPS.md` §1.
- Optional `ORIGIN_EDGE_SECRET` + header `X-ONIX-Edge-Secret` when a non-CF edge sits in front.
- Set `ALERT_WEBHOOK_URL` on API + worker for clawback/float/dispute SLA paging.

---

## DDoS / WAF / Cloudflare (2026-09)

**Не включайте оранжевое облако (Proxied) на `@` и `www`.** Российские сети рвут TLS до Cloudflare; сайт и вход перестанут открываться. DNS-only (серое облако) оставляем.

Что реально защищает канал:

| Слой | Как |
| --- | --- |
| Код | Host allowlist + optional edge secret; глобальный лимит ~240 req/мин на IP для `/api`, витрина 40/мин для гостей, JSON ≤ 128kb, WebSocket: Origin обязателен в production |
| Amvera | Одна реплика; **обязательно** закрыть прямой IP насколько позволяет панель; при L3/L4 флуде — тикет Amvera / смена IP |
| Cloudflare | Только DNS-only на www. WAF на orange **нельзя** для RU |
| Redis | Не открывать `0.0.0.0/0`. Если URL утечёт — ротация |
| Ops | `docs/architecture/ONIX-LAUNCH-BLOCKERS-OPS.md` — firewall verify + backup-drill + WS restart drill |

**Allowlist админки:** в админке → Сотрудники скопируйте «ваш IP» → Amvera env `ADMIN_IP_ALLOWLIST=1.2.3.4` (домашний/офисный публичный IP, не 127.0.0.1). Несколько через запятую. Перезапуск.

**Выдача модераторам:** Сотрудники → email + роль «Модератор / саппорт» (`SUPPORT_ADMIN`). Пароль сгенерируется. Это логин `/admin/`, не аккаунт маркета.

`ADMIN_IP_RESUME` по умолчанию выключен. Не включайте.

---

- Historical (webhook/Vercel **wrong** as of 2026-09): `ONIX-SINGLE-ORIGIN-MIGRATION.md`
- Bot login diagnostics: `ONIX-TELEGRAM-BOT-CHAIN-BREAK.md`
- Attachments code: `ONIX-CHAT-ATTACHMENTS-V1.md`
