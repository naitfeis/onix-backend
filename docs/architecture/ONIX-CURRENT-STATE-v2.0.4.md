# ONIX — текущее состояние и принятые решения

| | |
| --- | --- |
| **Обновлено** | **2026-09-10** (UTC+3) |
| **Линия кода** | `v2.0.4` / ship `v2.0.4-amvera` |
| **Коммит ориентир** | `692678b` — auth perimeter + launch-ops hooks |
| **Канон сайта** | `https://www.onixtg.shop` |
| **Этот файл** | единая «память» решений сентября 2026; детали runbook — в связанных docs |

> При конфликте: **код > этот файл > старые audit-доки**.  
> AI / человек: сначала читай §0–§3 здесь, потом узкие runbook’и.

---

## 0. Что такое ONIX (одной фразой)

**ONIX** — production P2P-маркетплейс цифровых товаров с **эскроу**, кошельком в копейках (`BigInt`), Telegram/Google входом, админ-плоскостью и фоновыми money/security воркерами. Не учебный CRUD.

### Поверхности

| Поверхность | Путь | Роль |
| --- | --- | --- |
| User SPA | `onix-frontend/` → `public/spa/` | маркет, сделки, чаты, вход |
| Admin SPA | `onix-admin/` | control plane (не путать с `Admin.tsx` во фронте) |
| API + workers | `safe-deal-platform/` | истина домена и денег |
| Schema | `prisma/` | PostgreSQL / Neon |

Истина денег: **backend + БД**, не UI и не Telegram.

---

## 1. Продакшен-топология (решение сентября 2026)

```text
User (RU)
  → Cloudflare DNS-only (серое облако)  www / @
  → Amvera Moscow ingress 158.160.116.199
  → Nest :3000  (SPA + /api same-origin)

Telegram Bot API
  → POST https://www.onixtg.shop/api/telegram/webhook

Neon (Frankfurt)     = PostgreSQL
Render Valkey        = Redis (external rediss://)
```

### Жёсткие решения (не откатывать без явного запроса)

| Решение | Почему |
| --- | --- |
| **Cloudflare только DNS-only** | Оранжевый proxy → RST TLS у части RU ISP + ломает LE на Amvera |
| **Канон = www** | `__Host-` cookies host-bound; apex ≠ www |
| **Same-origin `/api`** | Никакого `VITE_API_URL` на Render / `api.onixtg.shop` в браузере |
| **Amvera = публичный compute** | Render остаётся staging |
| **1 реплика Amvera** | Пока www смотрит сюда |
| **Git ship** | Amvera Git branch = **`v2.0.4-amvera`** (не `v1.3-amvera` / не «просто v2.0.4» без `-amvera`, если панель смотрит на `*-amvera`) |

---

## 2. Ветки и деплой

| Ветка | Назначение |
| --- | --- |
| `v2.0.4` | ежедневная линия разработки / push |
| `v2.0.4-amvera` | **то, что должна тянуть Amvera** |
| Старые `v2.0.3-amvera`, `v1.x-amvera` | история; не ждать от них новых фич |

**Почему «Amvera не подхватывает»:** панель смотрит на старую `*-amvera` ветку. Сменить на `v2.0.4-amvera` → redeploy.

Старт контейнера: `scripts/start-amvera.mjs` → `prisma migrate deploy` → `node dist/main.js`.  
Migrate **не** на этапе build.

---

## 3. Обязательные env (Amvera, этап «Запуск»)

### Периметр / старт процесса

| Переменная | Значение / смысл |
| --- | --- |
| `AMVERA=1` | production posture (origin guard и др.) |
| `ALLOWED_HOSTS` | `www.onixtg.shop,onixtg.shop` |
| `ORIGIN_GREY_CLOUD_ACK` | **`grey-cloud-accepted`** — без этого bootstrap **FATAL** (лог: Origin launch gate) |
| *или* `ORIGIN_EDGE_SECRET` | если появится edge, который шлёт `X-ONIX-Edge-Secret` |

**Смысл ACK:** на grey-cloud `https://IP` + `Host: www` = тот же вход, что DNS. Cloudflare WAF не в пути. ACK = сознательное принятие «периметр = app rate-limit + Host allowlist», а не «мы за CF WAF».

Live probe (2026-09-10): `Host: IP` → 404; IP+`Host: www` → 200/401; домен → 200.  
Evidence: `docs/architecture/ops-evidence/origin-probe-latest.json`.

### Алерты

| Переменная | Смысл |
| --- | --- |
| `ALERT_WEBHOOK_URL` | Slack Incoming Webhook (JSON POST). **Бесплатно.** Без него алерты только в лог |
| `ERROR_WEBHOOK_URL` | опционально, error tracker |

Slack: Blank app → Incoming Webhooks → канал/DM → URL в Amvera.  
Не нужен Slack CLI / Bolt / AI agent.  
URL = секрет; не светить в чатах; при утечке — revoke + новый.

### Уже критичные (не забывать)

| Переменная | Смысл |
| --- | --- |
| `DATABASE_URL` | Neon (с Amvera обычно pooler OK) |
| `REDIS_URL` | external Valkey |
| `BOT_TOKEN` | Telegram bot |
| `TELEGRAM_WEBHOOK_SECRET` | = `secret_token` в setWebhook |
| `GOOGLE_CLIENT_ID` | runtime GIS; **без Client Secret** |
| `AUTH_ED25519_CURRENT_*` | access JWT |
| Ed25519 rotate | `npm run auth:rotate-ed25519` (не `generate` для ротации) |

---

## 4. Решения по безопасности / деньгам (v2.0.3–v2.0.4)

### Auth / сессии

| Тема | Решение |
| --- | --- |
| Refresh reuse / race | Concurrent-тесты; reuse → revoke family + theft event |
| Google id_token | `aud` / `iss` / `exp` / `email_verified` |
| Admin RBAC | `@AdminRoles` + guard на бэке (не только UI) |
| Telegram webhook | Secret обязателен; **durable `update_id`** через `IdempotencyRecord` (`telegram:webhook`, TTL 7d) |
| Prompt dedupe | 60s in-memory (UX); не замена durable update_id |
| Telegram Wallet | **HARD GATE:** нельзя вешать деньги на bot webhook без transactional payment idempotency |
| Ed25519 | CURRENT + PREVIOUS verify; retire PREVIOUS только через guard ≥ access TTL |

### Деньги / эскроу

| Тема | Решение |
| --- | --- |
| Комиссия | 5% BPS, `fee + payout = total` (integer trunc) |
| Clawback | ≤ seller payout; fee не клоубится с продавца; OPEN/PARTIAL + withdraw block |
| Deposit dispute | `holdForDispute` умеет re-freeze после RELEASED |
| CI money tests | В основном **in-memory `LedgerModel`** — инварианты, не Postgres race |
| Postgres race | Код: `updateMany` + `quantity: { gte }`; drill: `npm run ops:db-concurrency-drill` |

### Ops / репутация

| Тема | Решение |
| --- | --- |
| Dispute SLA | Worker `dispute-sla`: DISPUTE старше `DISPUTE_SLA_DAYS` (7) → `DISPUTE_SLA_BREACH` + ticket CRITICAL + page. **Без auto-refund** |
| Clawback / float alerts | Gauges + `AlertingService.page()` / webhook |
| Backup | PITR Neon + `ops:backup-drill -- verify` на **Direct** scratch (не pooler) |

---

## 5. Money-launch gates (статус на 2026-09-10)

| Gate | Статус | Комментарий |
| --- | --- | --- |
| Origin Host:IP abuse | **CLOSED** | 404 |
| Origin grey-cloud / ACK | **PASS_WITH_ACK** при env | без ACK — FATAL старт |
| Slack `ALERT_WEBHOOK_URL` | **ops** | webhook проверен (`ok`); нужен в Amvera |
| Backup `verify` | **BLOCK** | нужен Neon Direct scratch; с ПК часто P1001 |
| DB concurrency drill | **GAP** | скрипт есть; connect с ноутбука падал |
| Dispute SLA code | **PASS** | нужен worker + migrate на проде |
| Amvera на `v2.0.4-amvera` | **ops** | сменить ветку в панели |

Checklist: `docs/architecture/ONIX-LAUNCH-BLOCKERS-OPS.md`  
Evidence (redacted): `docs/architecture/ops-evidence/`

---

## 6. Команды ops (шпаргалка)

```powershell
# Origin live probe
npm run ops:origin-probe

# Backup
npm run ops:backup-drill -- check
npm run ops:backup-drill -- diagnose-restore
# RESTORE_DATABASE_URL = Neon Direct scratch (без -pooler)
npm run ops:backup-drill -- verify

# Real Postgres stock race
$env:CONCURRENCY_DRILL_DATABASE_URL = "postgresql://…direct…"
npm run ops:db-concurrency-drill

# Ed25519 rotate (не generate для live rotate)
npm run auth:rotate-ed25519 -- --render
```

Slack test (PowerShell):

```powershell
$body = @{ text = "ONIX alert test" } | ConvertTo-Json
Invoke-RestMethod -Method Post -ContentType "application/json" -Body $body -Uri $env:ALERT_WEBHOOK_URL
```

---

## 7. Продуктовые инварианты (не ломать)

- Эскроу state machine: спор/refund/complete только через разрешённые переходы.
- Идемпотентность денежных операций (ключи + ledger).
- Продажа после Google — только с привязанным Telegram.
- Admin wipe / удаление — блок при open escrow / ненулевом балансе.
- Не включать `TRUST_CDN_HEADERS=true` пока Cloudflare orange выключен.
- Chat R2: storageKey только с бэка; magic-bytes на complete.

---

## 8. Карта документов

| Документ | Роль |
| --- | --- |
| **Этот файл** | текущие решения + статус gates |
| `docs/Documentation/Onix-Notes.md` | полный AI/engineering context |
| `docs/architecture/ONIX-AMVERA-PRODUCTION.md` | Amvera/DNS/auth/R2 runbook |
| `docs/architecture/ONIX-LAUNCH-BLOCKERS-OPS.md` | чеклист до денег |
| `docs/architecture/ONIX-KEY-ROTATION-RUNBOOK.md` | ротация ключей |
| `docs/architecture/AMVERA-SHIP-v2.0.4.md` | ship note ветки |
| `docs/architecture/ops-evidence/*` | redacted evidence probes |

Исторические audit/hotfix `ONIX-HOTFIX-*`, `ONIX-AUTH-P*` — архив; не считать каноном топологии сентября 2026.

---

## 9. История обновлений этого файла

| Дата | Что зафиксировано |
| --- | --- |
| **2026-09-10** | Первая полная сводка v2.0.4: Amvera+grey-cloud ACK, Slack alerts, dispute SLA, durable Telegram update_id, money-launch gates, ветка `v2.0.4-amvera`, in-memory vs DB drills |
