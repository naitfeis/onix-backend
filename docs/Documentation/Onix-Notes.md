# ONIX — PROJECT CONTEXT / AI ENGINEERING CONTEXT

> Этот документ — главный контекст проекта для AI-кодеров (Cursor, Claude, ChatGPT и т.д.).
> Перед изменением кода сначала используй этот документ как карту системы.
> Не перестраивай архитектуру без явного запроса.
> Не заменяй существующие решения на более простые только потому, что они проще.
> ONIX — production-oriented P2P marketplace, а не учебный CRUD-проект.

---

# 0. REPOSITORY / APPLICATION BOUNDARIES

ONIX — не один frontend и не один backend. Репозиторий содержит несколько
самостоятельных application/data surfaces.

```text
ONIX
├── onix-frontend/          # USER APPLICATION — React/Vite
├── onix-admin/             # ADMIN APPLICATION — отдельный React/Vite app
├── safe-deal-platform/     # BACKEND — NestJS
├── prisma/                 # DATABASE SCHEMA + MIGRATIONS
├── public/spa/             # GENERATED BUILD OUTPUT — НЕ primary source
└── docs/                   # ARCHITECTURE / AUDIT / LEARNING
```

## onix-frontend

`onix-frontend/` — основное пользовательское приложение ONIX.

Оно отвечает за:
- marketplace UI;
- profile;
- orders/deals;
- chats;
- seller analytics;
- support;
- authentication client;
- API client;
- realtime UI.

Бизнес-истина и финансовая логика находятся не здесь, а в backend/database.

## onix-admin

`onix-admin/` — ОТДЕЛЬНОЕ административное приложение, а не часть
`onix-frontend`.

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

Назначение `onix-admin`:
- административный control plane;
- admin authentication;
- audit;
- order investigation;
- risk events;
- security flags;
- user investigation;
- withdrawal review.

Backend для admin находится отдельно:

`safe-deal-platform/src/admin/`

Важно:
- `onix-admin/` и `onix-frontend/` — разные приложения;
- `onix-frontend/src/screens/Admin.tsx` НЕ является заменой `onix-admin/`;
- admin UI нельзя считать обычным marketplace UI;
- изменения admin UI делаются в `onix-admin/`, а не в `public/spa/`;
- privileged operations должны проходить через backend admin security/RBAC;
- frontend admin не является source of truth и не может самостоятельно принимать
  финансовые или security-решения.

## safe-deal-platform

`safe-deal-platform/` — NestJS backend и основной центр domain/business logic.

Критические домены включают:
- auth / identity;
- marketplace;
- escrow/orders;
- economy/wallet/ledger;
- payments;
- withdrawals;
- risk;
- admin;
- realtime;
- workers;
- observability;
- idempotency.

## SOURCE-OF-TRUTH RULE

При изменении системы:

```text
USER FRONTEND ─┐
ADMIN FRONTEND ├──→ BACKEND ─→ DATABASE
TELEGRAM ──────┘
```

`onix-frontend`, `onix-admin`, Telegram и WebSocket не являются источником
финансовой/доменной истины.

Если задача относится к admin:
1. сначала искать `onix-admin/`;
2. затем соответствующий `safe-deal-platform/src/admin/` endpoint/service;
3. затем tests;
4. не чинить `onix-frontend/src/screens/Admin.tsx` только потому, что в имени
   есть `Admin`.

Если задача относится к деньгам/security/auth, всегда проверять backend/database
flow до изменения UI.

---

# 0.1 PRODUCTION OPS (2026-09) — READ THIS FIRST

Подробный runbook: этот раздел (§0.1). Amvera yaml живёт только на ветке `v1.4-amvera`.

Исторические docs (`ONIX-SINGLE-ORIGIN-MIGRATION.md`, cutover с Vercel→Render
webhook) описывают **июль 2026**. С сентября публичный origin — **Amvera Moscow**,
не Render и не Vercel rewrite.

```text
Canonical:  https://www.onixtg.shop     (SPA + /api, same origin)
Ingress:    A 158.160.116.199           (Amvera msk0, project api-onix)
Staging:    https://onix-api-47tj.onrender.com   (Render; no www DNS)
DB:         Neon eu-central-1
Redis:      Render Valkey EXTERNAL rediss://  (internal hostname fails from Amvera)
Webhook:    POST https://www.onixtg.shop/api/telegram/webhook
Git daily:  v1.3
Git Amvera: v1.3-amvera   (merge v1.3 → v1.3-amvera → push to deploy Moscow)
```

Жёсткие правила:

- Браузер **никогда** не ходит на `api.onixtg.shop` и не использует абсолютный
  `VITE_API_URL` на Render. Только same-origin `/api`.
- Cloudflare DNS **grey cloud** (DNS only) на `@` и `www`. Оранжевое облако =
  RST в РФ + Amvera не выпустит Let's Encrypt.
- Нет AAAA на `@` / `www`. Два A на один hostname нельзя.
- `__Host-` cookies привязаны к хосту: логин на `onixtg.shop` ≠ сессия на `www`.
  Канон — **www**.
- Amvera env **нет на build**. `VITE_*` в панели не попадает в уже собранный SPA.
  Google Client ID: runtime `GOOGLE_CLIENT_ID` + `GET /api/v2/auth/public-config`.
  **GOOGLE_CLIENT_SECRET не используется.**
- Telegram: не слать голое `/start`. Нужен deep link `?start=login_<id>` с сайта.
  GET `/api/telegram/webhook` в браузере → 404 (это POST-only).
- `TELEGRAM_WEBHOOK_SECRET` в Amvera = `secret_token` в `setWebhook`.
- R2 — вложения чата, не сайт. Без `R2_*` upload недоступен. Browser PUT идёт на
  Cloudflare R2 — из РФ может не открыться.
- Реплики Amvera = 1, пока `www` смотрит сюда.

DNS сайт (плюс почта reg.ru не трогать):

| Name | Type | Content |
| --- | --- | --- |
| `@` / `www` | A | `158.160.116.199` |
| `@` и отдельно `www` | TXT | `naitfeis222112-api-onix` |

---

# 0.2 KNOWN RISKS (do not paper over)

Что реально слабо / атакуемо после cutover. Код чинит часть; остальное — ops.

**Сделано в коде (2026-09):**
- Amvera больше не доверяет `CF-Connecting-IP` / `X-Real-IP` / leftmost `X-Forwarded-For`
  (спуф IP → обход rate-limit / admin allowlist / risk). `req.ip` после `trust proxy 1`.
  Вернуть CDN-заголовки только если снова включите оранжевое Cloudflare:
  `TRUST_CDN_HEADERS=true`.
- Google id_token уходит **POST** на tokeninfo (не в query URL логов). Проверяются
  `iss`, `exp`, `aud`, unverified email отклоняется.
- Webhook secret сравнивается timing-safe. Inventory требует
  `TELEGRAM_WEBHOOK_SECRET` в production.
- Все SERIALIZABLE money-пути (escrow, wallet fund/withdraw, payments settle,
  admin adjust, deposit unlock, clawback recover) идут через
  `withSerializableTransaction`: retry P2034 / `40001` / deadlock `40P01` целиком,
  без Telegram/HTTP внутри callback. Порядок локов: Order → Product → Users by id.
- Telegram outbox: `Notification.telegramPushedAt` пишется в той же TX, что и
  деньги/сообщение; Bot API — **после COMMIT** (`tryDeliverNotification`).
  Крах после commit / 5xx Telegram → worker `telegram-outbox` на том же Neon.
  Не слать Telegram из retryable SERIALIZABLE callback.
- Логи: `slog` redact'ит и message, и string fields, и итоговую JSON-строку.
  Bot webhook не пишет `message.text` / `callback_data` payload.
- Чат: `sanitizeChatText` на send/caption (теги, javascript:/data:, control chars).
- Google: вход — полная страница OAuth (`response_type=id_token`) на `{origin}/`,
  без GIS `/gsi/client` и без popup `/gsi/transform`. В Google Console
  Authorized redirect URI: `https://www.onixtg.shop/` (и localhost для Vite).
  Имя/фамилия/фото из tokeninfo пишутся в профиль (если нет Telegram-лица).
  Аватары `*.googleusercontent.com` проксируются через `/api/avatars`.
- Apex `onixtg.shop` → 301 `www` (кроме `/.well-known/`).

**Остаётся ops / архитектура — не «починить одним PR»:**
- Redis Valkey с inbound `0.0.0.0/0`: кто знает пароль URL — пишет в coordination.
  Сузить IP Amvera, когда узнаете egress, или вынести Redis ближе.
- Секреты, которые светились в чатах/скринах (JWT, bot, VPS, Neon) — **ротация**.
- Браузерный PUT в Cloudflare R2 из РФ может не дойти; это и доступность, и
  обход если bucket вдруг public.
- Два хоста (`www` vs apex): код 301 apex → www (кроме ACME). Канон всё ещё www.
- HSTS на год с `includeSubDomains`: любой будущий битый сертификат на поддомене
  снова убьёт Edge. Не вешать HSTS на хосты без валидного LE.
- Тариф 0.5 CPU / 1 GB — DoS по CPU дешевле, чем по логике. Rate-limit in-process
  не шарится между будущими репликами (сейчас реплика 1).
- Google `accounts.google.com` в РФ может резаться независимо от Amvera.
  Код больше не открывает GIS popup `/gsi/transform` (белый экран Edge +
  `initialize()` × N + `postMessage` null). Кнопка уходит на OAuth id_token.
  В Google Console: Authorized redirect URI `https://www.onixtg.shop/`.
- LoginChallenge 2 минуты; голое `/start` игнорируется — это не баг, не открывать
  confirm без payload.
- Worker (включая `telegram-outbox`) должен ходить в **тот же Neon**, что и API.
  Иначе после crash Telegram не догоняется. After-commit send на API остаётся
  быстрым путём; worker — гарантия доставки.

Не снижать Serializable/idempotency/escrow ради «упрощения». Деньги по-прежнему
только ledger.

---

# 1. ЧТО ТАКОЕ ONIX

ONIX — P2P marketplace для цифровых товаров.

Пользователь может:
- покупать цифровые товары;
- продавать цифровые товары;
- создавать лоты;
- общаться с продавцом/покупателем;
- оплачивать заказ;
- получать товар;
- подтверждать получение;
- открывать спор;
- получать/выводить деньги;
- оставлять отзывы.

Главная особенность ONIX — безопасность сделки.

ONIX использует escrow/ledger-модель:

BUYER
  ↓
создаёт заказ
  ↓
оплачивает
  ↓
деньги удерживаются системой
  ↓
SELLER выполняет заказ
  ↓
BUYER получает товар
  ↓
подтверждение / завершение
  ↓
деньги становятся доступными SELLER

Платформа не должна считать "баланс" простым числом, которое можно произвольно изменить.
Деньги должны проходить через финансовую модель/ledger.

---

# 2. ГЛАВНАЯ ЦЕЛЬ АРХИТЕКТУРЫ

ONIX должен быть:

- безопасным;
- транзакционно корректным;
- идемпотентным;
- устойчивым к повторным запросам;
- устойчивым к race conditions;
- масштабируемым;
- пригодным для дальнейшего развития;
- максимально независимым от Telegram;
- с минимальным количеством бизнес-логики на frontend.

Главное правило:

FRONTEND НЕ ЯВЛЯЕТСЯ SOURCE OF TRUTH.

Telegram НЕ ЯВЛЯЕТСЯ SOURCE OF TRUTH.

SOURCE OF TRUTH = ONIX BACKEND + DATABASE.

---

# 3. ТЕКУЩИЙ TECH STACK

## Frontend

- React 18
- TypeScript
- Vite 5
- Vitest
- Telegram WebApp SDK

Frontend используется в:
- обычном Web App;
- Telegram Mini App.

Frontend отвечает за:
- UI;
- состояние интерфейса;
- вызов API;
- отображение данных;
- WebSocket-события;
- UX.

Frontend НЕ должен самостоятельно решать:
- сколько денег у пользователя;
- можно ли вывести деньги;
- можно ли завершить заказ;
- какой риск пользователя;
- сколько должна стоить комиссия;
- имеет ли пользователь право на действие.

Все критические решения принимаются backend.

---

# 4. BACKEND

Backend:

- NestJS 11
- TypeScript
- Prisma 7
- PostgreSQL
- Neon

Backend — основной центр бизнес-логики.

Архитектурная цепочка:

HTTP / WebSocket
        ↓
Controller / Gateway
        ↓
Application / Service
        ↓
Domain logic
        ↓
Ledger / Orders / Risk / etc.
        ↓
Prisma
        ↓
PostgreSQL

Не переносить сложную бизнес-логику во frontend.

---

# 5. DATABASE

Database:

PostgreSQL на Neon.

Prisma используется как ORM.

Критические финансовые операции должны учитывать:

- database transactions;
- isolation;
- locking;
- race conditions;
- idempotency;
- atomicity.

Для особенно критических финансовых операций используется/предусматривается Serializable transaction.

Нельзя делать:

1. прочитать баланс;
2. изменить баланс;
3. сохранить баланс

без защиты от конкурентных операций.

Нельзя допускать:

Request A:
balance = 1000

Request B:
balance = 1000

A снимает 700
B снимает 700

Результат не должен позволить пользователю вывести 1400 при наличии 1000.

---

# 5A. CONCURRENCY / SERIALIZABLE RETRY STANDARD

Этот раздел является обязательным engineering pattern для большого обновления,
затрагивающего concurrent database operations.

Serializable transaction может завершиться конфликтом сериализации даже тогда,
когда бизнес-логика корректна. Поэтому retry должен быть частью общего паттерна,
а не локальным workaround только для escrow.

## Обязательный принцип

Если операция использует PostgreSQL `SERIALIZABLE` и Prisma transaction,
она должна рассматриваться как:

```text
BEGIN SERIALIZABLE
      ↓
business reads
      ↓
business writes
      ↓
COMMIT
      │
      ├── success → return
      │
      └── serialization conflict → retry whole transaction
```

Retry выполняется для ВСЕЙ транзакционной функции целиком.

Нельзя повторять только отдельный query после serialization failure.

## Canonical retry-wrapper

Использовать единый wrapper/helper проекта, если такой уже существует.
Если существующего общего helper нет, сначала найти все текущие
Serializable transaction sites и создать один общий abstraction вместо
нескольких разных локальных wrappers.

Концептуальный шаблон:

```ts
async function withSerializableRetry<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: {
    maxAttempts?: number;
  },
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await prisma.$transaction(
        (tx) => operation(tx),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (!isSerializationConflict(error) || attempt === maxAttempts) {
        throw error;
      }

      await backoff(attempt);
    }
  }

  throw new Error("unreachable");
}
```

Это КОНЦЕПТУАЛЬНЫЙ шаблон. Перед реализацией проверить фактический Prisma API,
версии проекта и существующие transaction helpers.

## Что считается serialization conflict

Retry разрешён только для ошибок, которые действительно означают retryable
concurrency/serialization conflict, например соответствующий Prisma/PostgreSQL
serialization failure.

Не делать:

```ts
catch {
  retry();
}
```

и не retry-ить:
- validation errors;
- authorization errors;
- insufficient funds;
- invalid state transition;
- business rule violations;
- constraint violations, которые не являются transient concurrency conflicts;
- внешние API errors;
- неизвестные ошибки.

## Retry invariants

Каждая попытка должна:

1. начинать НОВУЮ database transaction;
2. заново выполнять ВСЕ reads внутри transaction;
3. заново выполнять ВСЕ writes внутри transaction;
4. не использовать stale values из предыдущей попытки;
5. не отправлять внешние side effects внутри transaction;
6. не создавать двойной ledger effect;
7. сохранять idempotency semantics;
8. пробрасывать исходную ошибку после исчерпания attempts.

Особенно важно:

```text
attempt 1:
read balance = X
write ...

serialization conflict

attempt 2:
READ BALANCE AGAIN
write ...
```

а не:

```text
attempt 1:
read balance = X

serialization conflict

attempt 2:
reuse old balance X   ← WRONG
```

## External side effects

Не делать внутри Serializable transaction операции, которые нельзя
безопасно повторить:

- отправку денег через provider;
- Telegram Bot API;
- email;
- WebSocket delivery;
- notification delivery;
- HTTP requests во внешние сервисы.

Правильный принцип:

```text
DB transaction
    ↓
commit
    ↓
event/outbox/worker
    ↓
external side effect
```

Если существующая архитектура использует другой проверенный механизм,
не переписывать её без необходимости; сначала понять текущий flow.

## Idempotency + Serializable

`Serializable retry` НЕ заменяет idempotency.

Нужны оба слоя:

```text
duplicate request
       ↓
idempotency
       ↓
single logical operation
       ↓
Serializable transaction
       ↓
possible serialization retry
       ↓
one final financial effect
```

Повторная попытка transaction не должна считаться новой бизнес-операцией.

## Где ОБЯЗАТЕЛЬНО проверить pattern

Во время большого concurrency patch нельзя исправить только escrow и считать
задачу выполненной.

Нужно провести repository-wide поиск всех мест с:
- `Serializable`;
- `$transaction`;
- `isolationLevel`;
- wallet balance mutations;
- ledger writes;
- payment state transitions;
- withdrawal reservation/creation;
- escrow settlement;
- order state transitions;
- clawback;
- deposit unlock;
- reconciliation;
- worker lease/lock operations;
- других read-modify-write critical sections.

Для каждого найденного места определить:

| Area | Serializable | Retry | Idempotency | External side effect inside tx |
|---|---:|---:|---:|---:|
| Escrow / settlement | проверить | проверить | проверить | запретить |
| Wallet / balance | проверить | проверить | проверить | запретить |
| Ledger | проверить | проверить | проверить | запретить |
| Payments | проверить | проверить | проверить | запретить |
| Withdrawals | проверить | проверить | проверить | запретить |
| Deposits | проверить | проверить | проверить | запретить |
| Order transitions | проверить | проверить | проверить | запретить |
| Clawback | проверить | проверить | проверить | запретить |
| Reconciliation | проверить | проверить | проверить | запретить |
| Workers / leases | проверить | проверить | проверить | запретить |

Таблица — audit checklist, а не утверждение, что все перечисленные операции
уже используют Serializable. Точное состояние определяется текущим кодом.

## Scope of retry

Retry должен применяться только там, где он нужен.

Не превращать обычные read-only queries или весь backend в retrying system.

Но если конкретная операция является Serializable critical section, нельзя
оставлять один такой участок без общего retry policy только потому, что он
находится в другом модуле.

## Logging

Для exhausted serialization retries полезно логировать:
- operation name;
- attempt count;
- request/correlation ID;
- безопасный domain identifier, если допустимо;
- final error class.

Не логировать:
- tokens;
- secrets;
- passwords;
- payment credentials;
- полный sensitive payload.

## Tests

Для каждого critical Serializable flow после изменения добавить/обновить
tests, проверяющие минимум:

1. успешную первую попытку;
2. serialization conflict → успешный retry;
3. несколько конфликтов → eventual success;
4. исчерпание attempts → ошибка не скрывается;
5. non-retryable error → без retry;
6. idempotency сохраняется;
7. нет двойного ledger/balance effect;
8. concurrent requests не создают financial invariant violation.

Для money-critical paths желательно иметь concurrency/invariant tests, а не
только unit test wrapper-а.

## AI PATCH RULE

При большом concurrency update AI должен:

```text
SEARCH
  ↓
FIND ALL SERIALIZABLE / CRITICAL TRANSACTIONS
  ↓
CLASSIFY EACH SITE
  ↓
APPLY ONE CONSISTENT RETRY PATTERN
  ↓
CHECK IDEMPOTENCY
  ↓
CHECK EXTERNAL SIDE EFFECTS
  ↓
ADD / UPDATE CONCURRENCY TESTS
  ↓
RUN FULL RELEVANT TEST SUITE
```

Нельзя считать patch завершённым после исправления первого найденного места.

Текущий source code всегда имеет приоритет над этим документом: если
реализация отличается, сначала изучить её, затем минимально и последовательно
привести critical paths к этому стандарту.

---

# 6. ФИНАНСОВАЯ МОДЕЛЬ

ONIX использует ledger-подход.

Ledger должен рассматриваться как источник финансовой истины.

Нельзя решать финансовые задачи через:

user.balance += amount

без соответствующего ledger/event/transaction механизма.

Финансовые состояния должны быть объяснимыми.

Для любой суммы желательно иметь возможность ответить:

- откуда деньги появились;
- почему они были заморожены;
- почему стали доступны;
- почему были списаны;
- какая комиссия удержана;
- какая операция создала изменение.

---

# 7. ESCROW

Escrow — центральная часть marketplace.

Типичный lifecycle:

ORDER_CREATED
    ↓
PAYMENT_PENDING
    ↓
PAID / FUNDS_HELD
    ↓
IN_PROGRESS
    ↓
DELIVERED
    ↓
CONFIRMED
    ↓
COMPLETED

При оплате:

BUYER funds
    ↓
ONIX escrow
    ↓
SELLER выполняет заказ
    ↓
после завершения
    ↓
SELLER available funds

Деньги не должны переходить продавцу раньше предусмотренного условия.

---

# 8. ИДЕМПОТЕНТНОСТЬ

Любая операция, которая может повториться из-за:

- retry;
- network timeout;
- double click;
- duplicate webhook;
- reconnect;
- frontend retry;
- Telegram retry;
- proxy retry;

должна быть безопасной.

Особенно:

- payments;
- withdrawals;
- order transitions;
- ledger operations;
- auth;
- Telegram webhook;
- notifications.

Повторный запрос не должен дважды списывать/зачислять деньги.

---

# 9. ORDER STATE MACHINE

Заказ — не просто набор boolean-полей.

У заказа есть lifecycle.

Нельзя разрешать произвольный переход:

COMPLETED → PAID

или:

CANCELLED → DELIVERED

Переходы должны быть валидированы backend.

Перед добавлением нового статуса необходимо проверить существующую state machine.

Не создавать параллельную систему статусов без необходимости.

---

# 10. AUTHENTICATION

ONIX постепенно переходит от legacy authentication к Auth V2 / ONIX Identity Platform.

## Legacy

HS256 JWT.

## Auth V2

Используется:

- Ed25519 access token;
- HttpOnly refresh cookie;
- refresh endpoint;
- CSRF protection;
- single-flight refresh;
- AuthManager;
- AuthBroadcast.

Основной frontend lifecycle:

Unauthenticated
      ↓
restoreSession / login
      ↓
Authenticated
      ↓
Refreshing
      ↓
Authenticated

При ошибке refresh:

Refreshing
      ↓
LoggedOut

---

# 11. ONIX IDENTITY PLATFORM

ВАЖНО:

Telegram — НЕ identity system ONIX.

Telegram является Identity Provider, который подтверждает telegramId.

SOURCE OF TRUTH:

ONIX DB.

Упрощённая модель:

User
  ↓
IdentityLink
  ↓
Sessions
  ↓
Wallet / Orders / Reviews / etc.

ONIX не должен превращаться в "Telegram application, у которой есть marketplace".

ONIX — самостоятельная Identity Platform + marketplace.

---

# 12. TELEGRAM AUTH FLOW

Website (только `https://www.onixtg.shop`, вкладку не закрывать):

POST /api/v2/auth/telegram-bot/start
        ↓
https://t.me/<bot>?start=login_<challengeId>
        ↓
Telegram Bot  (голое `/start` без payload handler игнорирует)
        ↓
Bot Webhook POST /api/telegram/webhook
        ↓
OPENED
        ↓
USER CONFIRM
        ↓
CONFIRMED
        ↓
Website polling
        ↓
POST /api/v2/auth/.../complete
        ↓
AuthOrchestrator
        ↓
loginWithVerifiedTelegramIdentity
        ↓
SessionService
        ↓
TokenService
        ↓
HttpOnly __Host-onix cookie

Telegram должен только подтвердить identity.

Не переносить основную бизнес-логику marketplace в Telegram Bot.

---

# 13. TELEGRAM BOT

Bot используется как часть authentication chain и для Telegram-related функций.

Webhook:

Telegram
 ↓
/api/telegram/webhook
 ↓
Handler
 ↓
Repository / services
 ↓
Bot API

Критическое правило:

Webhook handler должен проверять результат выполнения критических операций.

Нельзя:

await sendMessage(...)
return { prompted: true }

если sendMessage реально мог завершиться ошибкой.

Ошибки Bot API должны логироваться.

---

# 14. API

API является контрактом между frontend и backend.

Перед изменением endpoint:

1. найти controller;
2. найти DTO;
3. найти service;
4. найти frontend caller;
5. найти tests;
6. понять текущий response contract;
7. только потом менять.

Не ломать существующий API ради "чистоты".

Если меняется response:
- обновить frontend;
- обновить tests;
- проверить backward compatibility.

---

# 15. DTO

DTO используется для boundary validation.

Не принимать произвольные данные от клиента.

Особенно проверять:

- amount;
- IDs;
- enum;
- order state;
- withdrawal data;
- product data;
- user input.

Нельзя доверять frontend validation.

Frontend validation = UX.

Backend validation = security.

---

# 16. RISK ENGINE

Risk Engine — отдельный security layer.

Архитектура:

Identity
 ↓
Auth
 ↓
Domain
 ↓
Transaction
 ↓
Ledger
 ↓
Risk
 ↓
Events
 ↓
WebSocket
 ↓
UI

Risk Engine анализирует подозрительные действия.

Возможные уровни:

LOW
MEDIUM
HIGH
CRITICAL

При HIGH / CRITICAL возможны:

- запрет новых продаж;
- запрет withdrawal;
- ограничение подозрительных операций;
- freeze связанных средств;
- revoke sessions;
- создание Security Case;
- создание admin ticket;
- категория RISK_ENGINE;
- уведомление пользователя.

Risk Engine НЕ должен без необходимости удалять аккаунт.

Предпочтение:

LIMIT / FREEZE / REVIEW

вместо:

DELETE.

---

# 17. RISK ENGINE И MARKETPLACE

Особое внимание:

- accounts;
- services;
- virtual goods;
- scam-heavy categories.

Risk Engine не должен одинаково жёстко применять правила ко всему marketplace.

Нужно учитывать context/category.

Например:

- количество сделок;
- количество отзывов;
- возраст аккаунта;
- история disputes;
- suspicious chat messages;
- payment patterns;
- withdrawal patterns;
- количество failed transactions.

Но риск-правила должны быть проверяемыми и объяснимыми.

---

# 18. CHAT MODERATION

Chat может быть источником risk signals.

Подозрительные сообщения:

- "подтверди заказ и я выдам товар";
- "переведи мне на карту";
- попытка вывести сделку за пределы ONIX;
- просьбы отменить escrow и провести оплату напрямую.

Такие сообщения могут повышать risk score.

ВАЖНО:

Chat moderation не должна напрямую ломать финансовую систему.

Правильнее:

Chat
 ↓
Moderation
 ↓
Risk signal
 ↓
Risk Engine
 ↓
Security Case / restriction

а не:

Chat message
 ↓
direct DB balance manipulation

---

# 19. CHAT И MONEY SYSTEM

Chat API и money API концептуально должны быть разделены.

Причина:

бот/спам в чате не должен положить финансовую систему.

Нельзя создавать архитектуру, где:

10 000 chat requests
    ↓
database overload
    ↓
financial transactions fail

Для масштабирования можно отдельно выносить:

- chat processing;
- WebSocket process;
- notifications;
- background jobs.

Но не делать это преждевременно без необходимости.

---

# 20. WEBSOCKETS

WebSocket используется для real-time событий:

- chat;
- notifications;
- order events;
- payment events;
- security events.

WebSocket — transport layer.

Он не должен становиться источником истины.

Если WebSocket потерян:

frontend должен восстановить состояние через API.

Правильный принцип:

DATABASE/API = truth
WEBSOCKET = realtime delivery

---

# 21. EVENTS

Для важных изменений желательно иметь event-driven архитектуру:

Domain action
    ↓
Event
    ↓
Subscribers
    ↓
Notification / WebSocket / Risk / Analytics

Но не превращать каждое простое действие в сложную event architecture.

Event нужен там, где он действительно помогает decouple systems.

---

# 22. NOTIFICATIONS

Есть минимум два важных типа:

- message notification;
- payment/order notification.

Например:

SELLER получил оплату
    ↓
event
    ↓
notification
    ↓
WebSocket / UI / sound

Frontend может проиграть приятный notification sound.

Но звук — UI concern.

Backend только сообщает событие.

---

# 23. PRODUCTS / LOTS

Marketplace состоит из lots/products.

Seller создаёт lot.

Buyer использует filters/search/sorting.

Важно различать:

PRODUCT/LOT
ORDER
TRANSACTION
PAYMENT
LEDGER ENTRY

Это НЕ одно и то же.

Пример:

Lot
 ↓
Order
 ↓
Payment
 ↓
Escrow
 ↓
Delivery
 ↓
Completion
 ↓
Ledger settlement

Не смешивать сущности.

---

# 24. COMMISSION

ONIX использует commission model.

Комиссия может быть динамической.

Идея:

меньше активности продавца
    ↓
ниже комиссия

больше lots / больше нагрузки
    ↓
выше комиссия

Но commission должен вычисляться backend.

Frontend только показывает результат.

Нельзя доверять amount/commission, присланным frontend.

---

# 25. WITHDRAWALS

Withdrawal — финансовая критическая операция.

Перед withdrawal проверять:

- authenticated user;
- available balance;
- locked balance;
- risk status;
- limits;
- idempotency;
- withdrawal status;
- fraud/risk checks.

Нельзя позволить:

available balance = 1000

и два параллельных withdrawal по 1000.

---

# 26. REVIEWS

Review привязан к реальной сделке.

Нельзя позволять произвольные отзывы от пользователей, которые не совершали соответствующую transaction/order.

Проверка должна быть backend-side.

---

# 27. FRONTEND ARCHITECTURE

React application.

Frontend должен быть относительно тонким.

Пример:

Component
 ↓
Hook
 ↓
API client
 ↓
Backend

Не:

Component
 ↓
10 файлов бизнес-логики
 ↓
самостоятельный расчёт денег
 ↓
прямая DB-like логика

UI должен отображать backend state.

---

# 28. AUTHMANAGER

AuthManager — центральная frontend auth abstraction.

Он управляет:

- access token;
- refresh;
- restore session;
- login;
- logout;
- auth state;
- refresh timer;
- broadcast;
- concurrent refresh.

Важный принцип:

не создавать второй независимый auth manager без необходимости.

Если меняется auth flow — сначала найти существующий AuthManager.

---

# 29. API REQUESTS

Если access token истёк:

request
 ↓
401
 ↓
single-flight refresh
 ↓
retry original request

Не делать 10 refresh requests одновременно.

Пример:

Request A → 401
Request B → 401
Request C → 401

Должен быть:

A ─┐
B ─┼→ ONE refresh → retry
C ─┘

---

# 30. SECURITY

Никогда не доверять:

- frontend;
- Telegram Mini App client;
- browser;
- localStorage;
- user-supplied amount;
- user-supplied commission;
- user-supplied order state.

Клиент может быть полностью скомпрометирован.

Backend должен предполагать:

"клиент врёт".

---

# 31. SECRETS

Никогда не коммитить:

- JWT secrets;
- private keys;
- bot tokens;
- database passwords;
- API keys;
- refresh secrets.

Использовать environment variables.

Не вставлять secrets в frontend bundle.

---

# 32. INFRASTRUCTURE

Текущая схема (2026-09): §0.1 выше.

```text
Browser (RU)
    ↓  DNS only (Cloudflare nameservers, grey cloud)
https://www.onixtg.shop
    ↓  A 158.160.116.199
Amvera Moscow (Nest SPA+API :3000)
    ├── Neon PostgreSQL (Frankfurt)
    └── Redis / Valkey (Render Frankfurt, external URL)
Telegram webhook → same www origin
Render onix-api-47tj = staging only
```

Не возвращать публичный origin на Cloudflare orange / Vercel rewrite / Render
custom domain `www` — это ломает РФ и `__Host-` cookies / сертификаты.

---

# 33. CLOUDFLARE

Cloudflare здесь **только DNS** (и опционально R2 для файлов чата).

Не включать proxy на `@` / `www`. Не использовать Cloudflare Workers как
обязательный путь к API.

Почта (MX, SPF, ftp/mail A) остаётся на reg.ru и к сайту не относится.

---

# 34. RENDER (STAGING)

Render Web Service `onix-api-47tj` — **dev/staging**, URL
`https://onix-api-47tj.onrender.com`.

После cutover кастомный домен `www.onixtg.shop` с Render снять (слоты сертификатов
конфликтуют). Worker Render можно оставить.

Не деплоить дневную работу в `v1.3-amvera` в обход merge с `v1.3`, кроме
Amvera-only yaml/start scripts.

---

# 35. REDIS

Redis рекомендуется для P0/P1 задач, где нужны:

- distributed locks;
- rate limiting;
- queues;
- caching;
- session coordination;
- websocket scaling.

Но Redis нельзя добавлять просто "потому что так делают большие проекты".

Каждое новое infrastructure dependency увеличивает complexity.

---

# 36. TESTING

Backend tests существуют.

Frontend tests существуют.

Известное состояние:

Backend: 85/85 tests
Frontend: 45/45 tests

При изменении критического кода:

- сначала понять существующие tests;
- не удалять тесты ради прохождения;
- добавлять regression test для bug fix.

Особенно тестировать:

- auth;
- order state transitions;
- payments;
- ledger;
- withdrawals;
- risk;
- idempotency.

---

# 37. MIGRATIONS

Prisma migrations — часть production architecture.

Не менять schema вручную в production без понимания migration state.

Перед изменением Prisma schema проверить:

- existing migrations;
- relations;
- indexes;
- unique constraints;
- nullable fields;
- production implications.

---

# 38. LOGGING

Логи должны отвечать:

"На каком шаге сломалась цепочка?"

Для сложных flows использовать последовательные logs.

Например:

[Bot] webhook received
[Bot] identity found
[Bot] confirmation created
[Bot] message sent
[Bot] status updated
[Auth] identity verified
[Auth] session created

Но:

НЕ логировать secrets,
tokens,
passwords,
private data.

---

# 39. ERROR HANDLING

Ошибки должны быть:

- предсказуемыми;
- типизированными;
- понятными;
- пригодными для debugging.

Не использовать:

catch (e) {
  return success;
}

для критических операций.

Особенно:

payments
ledger
withdrawals
auth
Telegram confirmation.

---

# 40. ADMIN / SECURITY CASES

Admin panel в будущем/существующей архитектуре должна видеть:

- user;
- order;
- transaction;
- risk score;
- security case;
- disputes;
- withdrawal;
- relevant events.

Security Case должен сохранять контекст причины блокировки.

Не создавать "магический бан".

Нужно понимать:

WHO
WHAT
WHEN
WHY
WHICH RULE
WHICH TRANSACTION

---

# 41. DATA OWNERSHIP

Условно:

AUTH → Identity / Sessions
MARKETPLACE → Products / Lots / Orders
MONEY → Wallet / Ledger / Transactions
RISK → Risk signals / Security cases
CHAT → Conversations / Messages
NOTIFICATIONS → Notification state
REVIEWS → Reviews
ADMIN → Moderation / Security

Не смешивать ответственность модулей.

---

# 42. DOMAIN BOUNDARIES

Если добавляется feature, сначала определить:

К какому domain она относится?

Например:

"Продавцу пришёл звук после оплаты"

НЕ надо добавлять sound logic в payment service.

Правильно:

Payment
 ↓
PaymentCompleted event
 ↓
Notification
 ↓
WebSocket
 ↓
Frontend
 ↓
Sound

---

# 43. ПРАВИЛО "НЕ ПЕРЕСТРАИВАЙ ВСЁ"

Если пользователь просит:

"добавь X"

НЕ нужно:

- переписывать весь module;
- менять ORM;
- менять auth;
- менять database architecture;
- вводить новый framework;
- менять deployment.

Сначала найти минимальную безопасную точку изменения.

ONIX уже является работающим проектом.

Главная задача AI:

MAKE TARGETED CHANGES.

---

# 44. ПРАВИЛО ПЕРЕД ИЗМЕНЕНИЕМ

Перед coding:

1. Search repository.
2. Найди существующую реализацию.
3. Найди все references.
4. Определи owner domain.
5. Проверь tests.
6. Проверь DB schema если затрагиваются данные.
7. Проверь API contract.
8. Только после этого редактируй.

Не угадывать названия файлов.

---

# 45. ПРАВИЛО ПОИСКА

Если пользователь говорит:

"исправь оплату"

не начинать писать код сразу.

Сначала найти:

- payment controller;
- payment service;
- order service;
- ledger service;
- transaction;
- DTO;
- frontend payment caller;
- tests;
- related events.

После понимания цепочки — минимальный patch.

---

# 46. НЕ СОЗДАВАТЬ ДУБЛИКАТЫ

Перед созданием:

Service
Hook
DTO
Guard
Utility
Repository
Component

сначала search:

"Есть ли уже аналог?"

Если есть — использовать существующий.

Не создавать:

PaymentService2
AuthServiceNew
NewOrderManager

только потому, что существующий код кажется неудобным.

---

# 47. BACKWARD COMPATIBILITY

ONIX развивается поэтапно.

Если legacy flow всё ещё используется:

НЕ удалять его автоматически.

Особенно:

- legacy JWT;
- Auth V2;
- old API;
- old frontend flow.

Migration должна быть намеренной.

---

# 48. VERSIONING

Проект уже имеет release history.

Известный release:

v1.0.0

Git branch/release history имеет значение.

Перед большим изменением:

- понимать текущую версию;
- понимать migration state;
- не смешивать unrelated changes.

---

# 49. ПРОЕКТ НЕ УЧЕБНЫЙ

Не применять учебные паттерны, которые упрощают код ценой безопасности.

Например:

ПЛОХО:

if (user.balance >= amount) {
  user.balance -= amount;
}

ХОРОШО:

transaction
+
locking/isolation
+
ledger
+
idempotency
+
validated state transition.

---

# 50. ПРИОРИТЕТЫ

При конфликте требований:

1. Security
2. Financial correctness
3. Data integrity
4. Authentication correctness
5. Domain correctness
6. Reliability
7. Tests
8. Performance
9. UX
10. Code aesthetics

Красивый код не важнее корректных денег.

---

# 51. ПРИОРИТЕТЫ ПРИ DEBUGGING

Если что-то не работает:

1. reproduce;
2. identify exact failing layer;
3. inspect logs;
4. inspect request;
5. inspect DB state;
6. inspect transaction;
7. inspect related events;
8. fix root cause;
9. add regression test;
10. verify full flow.

Не маскировать ошибку.

---

# 52. ПРИОРИТЕТЫ ПРИ НОВОЙ FEATURE

Для новой функции:

FEATURE
 ↓
DOMAIN
 ↓
DATA MODEL
 ↓
API
 ↓
BUSINESS LOGIC
 ↓
SECURITY
 ↓
EVENTS
 ↓
FRONTEND
 ↓
TESTS

Не начинать с UI, если feature затрагивает деньги или security.

---

# 53. ФИНАНСОВЫЙ FLOW

Пример полного flow:

Buyer
 ↓
POST create order
 ↓
OrderService
 ↓
validate lot
 ↓
validate seller
 ↓
calculate price
 ↓
calculate commission
 ↓
Payment
 ↓
transaction
 ↓
Ledger
 ↓
Escrow
 ↓
Order = PAID
 ↓
Event
 ↓
Notification
 ↓
WebSocket
 ↓
Seller UI
 ↓
Seller delivers
 ↓
Buyer confirms
 ↓
Order completes
 ↓
Ledger settlement
 ↓
Seller available balance

Каждый критический переход должен быть backend controlled.

---

# 54. SECURITY FLOW

Пример:

User action
 ↓
Auth
 ↓
Permission
 ↓
Domain validation
 ↓
Transaction
 ↓
Risk Engine
 ↓
Event
 ↓
Notification / Security Case

Risk не должен быть "декоративным score".

Если risk policy требует restriction — restriction должна реально применяться backend.

---

# 55. НЕ ДОВЕРЯТЬ FRONTEND

Например frontend отправляет:

{
  amount: 100,
  commission: 0,
  sellerId: "..."
}

Backend НЕ должен принимать commission как истину.

Backend сам:

- определяет цену;
- определяет commission;
- проверяет seller;
- проверяет lot;
- проверяет buyer;
- рассчитывает итог.

Frontend payload — только request.

---

# 56. PERFORMANCE

Сначала correctness.

Не оптимизировать заранее.

Но избегать очевидных проблем:

- N+1 queries;
- unnecessary DB calls;
- loading entire tables;
- duplicate API requests;
- uncontrolled WebSocket broadcasts.

При необходимости:

- indexes;
- caching;
- Redis;
- queues;
- pagination.

---

# 57. PAGINATION

Marketplace может содержать огромное количество lots.

Не загружать весь marketplace сразу.

Использовать pagination/infinite loading.

Frontend должен поддерживать:

- loading;
- empty;
- error;
- pagination;
- retry.

---

# 58. UI / DESIGN

ONIX — marketplace, не обычный магазин.

UI должен помогать пользователю:

- быстро находить lots;
- сравнивать sellers;
- видеть trust signals;
- понимать order status;
- видеть security state;
- совершать покупку без лишних действий.

Текущий визуальный стиль ориентирован на dark UI.

---

# 59. TRUST / SELLER SIGNALS

Marketplace должен учитывать trust signals:

- reviews;
- number of deals;
- account age;
- seller activity;
- disputes;
- risk status.

Но trust signals не должны сами по себе автоматически означать scam.

Они являются inputs для risk/trust systems.

---

# 60. ANALYTICS

Возможная Store Analytics:

Seller может видеть:

- views;
- purchases;
- income;
- sales per day;
- conversion;
- popular lots.

Analytics не должна вмешиваться в financial truth.

Analytics = read model / reporting.

Ledger = financial truth.

---

# 61. ONIX+

Возможная subscription layer:

ONIX+

Потенциальные возможности:

- promotion lots;
- larger attachments;
- cashback;
- additional seller features.

Subscription не должна быть hardcoded в каждом компоненте.

Если feature зависит от subscription:

Subscription/Entitlement
 ↓
backend permission
 ↓
frontend presentation

---

# 62. FILE ATTACHMENTS

В chat/marketplace могут использоваться attachments.

Ограничения должны проверяться backend.

Нельзя полагаться только на frontend file size validation.

---

# 63. КОДОВЫЕ ПРИНЦИПЫ

Предпочитать:

- explicit code;
- readable services;
- small focused functions;
- typed DTOs;
- predictable errors;
- clear domain boundaries.

Избегать:

- magic;
- hidden side effects;
- global mutable state;
- giant services;
- duplicated logic;
- unnecessary abstractions.

---

# 64. AI CODING RULE

AI должен изменять существующую архитектуру, а не создавать собственную параллельную ONIX.

Перед кодом ответь себе:

1. Где уже реализована эта логика?
2. Какой domain владеет ей?
3. Какой существующий service должен измениться?
4. Есть ли существующий DTO?
5. Есть ли существующий event?
6. Есть ли test?
7. Затрагивает ли это money/security/auth?
8. Какие race conditions возможны?
9. Что произойдёт при повторном запросе?
10. Что произойдёт при partial failure?

---

# 65. AI CODING RULE — НЕ ТРАТИТЬ ТОКЕНЫ НА БЕСПОЛЕЗНОЕ ИССЛЕДОВАНИЕ

Если задача уже однозначна:

НЕ нужно писать длинный анализ.

Сделай:

- targeted repository search;
- inspect relevant files;
- patch;
- test.

Не перечитывай весь repository.

Используй этот документ как архитектурный индекс.

---

# 66. AI CODING RULE — ЕСЛИ НЕ УВЕРЕН

Если неизвестно, где находится логика:

SEARCH.

Не угадывай.

Если найдено несколько реализаций:

сравни references и tests.

Если изменение может затронуть деньги:

остановись и сначала проверь transaction/ledger flow.

Если изменение может затронуть auth:

проверь AuthManager + backend auth flow.

Если изменение может затронуть order:

проверь state machine.

---

# 67. AI CODING RULE — НЕ ЛОМАТЬ РАБОТАЮЩЕЕ

Перед изменением существующего поведения:

- понять зачем оно существует;
- найти tests;
- проверить references;
- определить compatibility requirements.

"Можно сделать проще" НЕ означает "нужно переписать".

---

# 68. DEFINITION OF DONE

Feature считается готовой только если:

- backend работает;
- frontend работает;
- security проверена;
- validation работает;
- error handling работает;
- relevant tests проходят;
- нет очевидных race conditions;
- API contract согласован;
- DB changes оформлены;
- logs/debugging достаточны;
- нет secrets;
- нет лишних duplicate implementations.

---

# 69. ОСНОВНАЯ МЕНТАЛЬНАЯ МОДЕЛЬ

ONIX НЕ является:

"React + Nest CRUD".

ONIX является:

IDENTITY PLATFORM
+
P2P MARKETPLACE
+
ESCROW
+
LEDGER
+
RISK ENGINE
+
REALTIME CHAT
+
NOTIFICATIONS
+
ADMIN/SECURITY SYSTEM

Поэтому изменения нужно рассматривать системно.

---

# 70. ГЛАВНАЯ ЦЕПОЧКА ONIX

USER
 ↓
IDENTITY
 ↓
AUTH
 ↓
PERMISSIONS
 ↓
DOMAIN
 ↓
ORDER
 ↓
PAYMENT
 ↓
LEDGER / ESCROW
 ↓
RISK
 ↓
EVENTS
 ↓
WEBSOCKET / NOTIFICATIONS
 ↓
UI

Эта цепочка является основной архитектурной mental model проекта.

---

# 71. ЕСЛИ ПОЛЬЗОВАТЕЛЬ ПРОСИТ ИЗМЕНЕНИЕ

AI должен:

1. понять требование;
2. определить affected domain;
3. найти существующий implementation;
4. определить минимальный набор файлов;
5. изменить код;
6. запустить relevant tests;
7. проверить edge cases;
8. сообщить, что изменено.

Не делать massive refactor без запроса.

---

# 72. КОРОТКО

Если нужно запомнить только 15 вещей:

1. ONIX — P2P marketplace.
2. Backend = source of truth.
3. PostgreSQL/Neon = persistent source of truth.
4. Ledger = financial truth.
5. Escrow защищает сделки.
6. Деньги требуют transaction + idempotency + concurrency safety.
7. Frontend нельзя доверять.
8. Telegram — Identity Provider, не источник истины ONIX.
9. Auth V2 использует Ed25519 + HttpOnly refresh.
10. Risk Engine — security layer.
11. Chat не должен ломать money system.
12. WebSocket — delivery mechanism, не source of truth.
13. Existing architecture предпочтительнее новой.
14. Перед coding нужно search existing implementation.
15. Минимальный безопасный patch лучше massive rewrite.

---

# FINAL AI INSTRUCTION

Ты работаешь НЕ над новым проектом.

Ты работаешь над уже существующей системой ONIX.

Твоя задача — понимать существующую архитектуру, уважать её boundaries и вносить минимальные, точные, production-safe изменения.

НЕ переписывай систему без причины.

НЕ создавай дубликаты.

НЕ доверяй frontend.

НЕ упрощай финансовую логику.

НЕ обходи backend security.

НЕ скрывай ошибки.

НЕ удаляй существующие tests.

СНАЧАЛА SEARCH → ПОТОМ UNDERSTAND → ПОТОМ PATCH → ПОТОМ TEST.

Если изменение затрагивает деньги, auth, orders или risk — относись к нему как к потенциально критическому изменению production-системы.

---

# 41. AI CHANGE CHECKLIST

Перед любым существенным изменением:

1. Определи, в каком application surface находится задача:
   - `onix-frontend/`;
   - `onix-admin/`;
   - `safe-deal-platform/`;
   - `prisma/`;
   - infrastructure/docs.
2. Не путай `onix-admin/` с `onix-frontend/src/screens/Admin.tsx`.
3. Для money/auth/security сначала найди backend owner и связанные tests.
4. Для Serializable/concurrency проведи поиск ВСЕХ релевантных critical
   transaction sites, а не только первого найденного.
5. Используй единый retry pattern для retryable serialization conflicts.
6. Не retry-ь произвольные ошибки.
7. Retry transaction = повтор всей transaction с новыми reads.
8. Не выполняй неретриируемые external side effects внутри transaction.
9. Idempotency и concurrency safety должны работать вместе.
10. Не меняй generated `public/spa/` вместо source.
11. Не создавай дублирующие services/modules без необходимости.
12. После изменения critical path добавь/обнови regression/concurrency tests.
13. Если текущий код и документация расходятся — текущий код/инвентарь побеждает,
    но документацию следует обновить после подтверждённого structural change.

Главный принцип:

```text
SEARCH → UNDERSTAND → CLASSIFY → PATCH → TEST → VERIFY
```

а не:

```text
FIND ONE BUG → PATCH ONE FILE → ASSUME SYSTEM FIXED
```
