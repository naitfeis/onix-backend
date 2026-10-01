# Урок 30 — как устроен ONIX: архитектура, Ed25519, безопасность

Это не урок JavaScript. Это карта проекта, чтобы ты мог **сам** менять код и не сломать деньги, сессии и вход.

Читай сверху вниз один раз. Потом возвращайся к разделам как к справочнику.

Связанные файлы (не дублируй их, а открывай по делу):

- [Урок 31](./31-onix-web-stack-vite-react-nest.md) — origin, SPA, Vite, React, NestJS, Google Console, CSP
- `docs/Documentation/Onix-Notes.md` — ops, DNS, прод, что нельзя упрощать
- `docs/Documentation/PS_Onix-FileStructure.md` — карта файлов
- `docs/architecture/ONIX-PRIVACY-FIRST-SECURITY.md` — privacy / device trust
- `docs/architecture/ONIX-KEY-ROTATION-RUNBOOK.md` — ротация ключей
- `docs/architecture/ONIX-REDIS-SCALE-COORDINATION.md` — Redis

---

## 1. Что это за продукт

ONIX — P2P-маркетплейс цифровых товаров с **escrow** (сейф платформы): деньги покупателя замораживаются, товар передаётся, потом выплата продавцу или возврат.

Деньги — не «число в профиле». Это **ledger** (журнал проводок) в PostgreSQL. Баланс — следствие проводок, не источник истины.

Три приложения в одном репозитории:

```text
onix-frontend/          сайт покупателя/продавца (React + Vite)
onix-admin/             отдельная админка (не путать с экраном в SPA)
safe-deal-platform/     NestJS API + воркер
prisma/                 схема БД и миграции
public/spa/             СБОРКА фронта, не редактировать руками
```

Бизнес-логика и деньги живут **только в backend**. Фронт рисует UI и держит access-токен в памяти.

---

## 2. Где крутится прод (2026-09)

| Что | Где |
| --- | --- |
| Сайт + API | Amvera Moscow, `https://www.onixtg.shop` (один origin: SPA и `/api`) |
| Staging API | Render `v1.4-render` → `onix-api-47tj.onrender.com` |
| База | Neon PostgreSQL, Frankfurt |
| Redis / Valkey | сейчас Render Frankfurt (лучше перенести на Amvera, см. §11) |
| DNS | Cloudflare **grey cloud** (только DNS). Оранжевое облако ломает РФ и сертификат |

Ветки:

| Ветка | Назначение |
| --- | --- |
| `v1.4-render` | дневная работа + staging Render |
| `v1.4-amvera` | прод Москва. Сюда **merge** с render, не наоборот в обход |
| `main` | не класть дневной прод сюда, пока так не решите явно |

Канон хоста — **`www.onixtg.shop`**. Cookie `__Host-onix_rt` привязана к хосту: логин на `onixtg.shop` без www — другая сессия. Apex редиректит на www.

---

## 3. Как запрос проходит через систему

```text
Браузер  https://www.onixtg.shop
   │
   ├─ статика SPA (index.html, JS)
   └─ /api/*  → тот же Nest-процесс
         │
         ├─ Helmet CSP, HSTS, canonical www
         ├─ AuthGuard (legacy HS256 и/или Auth V2 EdDSA)
         ├─ Prisma → Neon
         └─ Redis coordination (rate-limit, refresh-grace, realtime fan-out)
```

Website bootstrap (`onix-frontend/src/hooks/useOnixCore.ts`):

```text
открыли сайт
  → сразу публичный каталог (гость видит лоты)
  → POST /api/v2/auth/refresh  (cookie, не Bearer)
       401  → гость, форма входа
       сеть → не гость: ждём / повторяем, cookie не трогаем
       200  → access в памяти → GET /api/users/me → профиль
```

Access-токен **не** кладётся в localStorage. После F5 его нет — его снова выдаёт refresh.

---

## 4. Лучшие архитектурные решения (и почему их нельзя «упростить»)

### 4.1 Same-origin SPA + API

Сайт и API на одном хосте. Браузер шлёт cookie на `/api` без CORS-плясок. `__Host-` cookie требует Secure + Path=/ + **без Domain**.

Не возвращать схему «Vercel rewrite → Render»: из РФ это RST, таймауты, ложный гость.

### 4.2 Деньги: BigInt копейки + ledger

В БД сумма — `BigInt` (копейки). В JSON — **строка**, не `number` (у JS нет безопасных int64).

Любое движение денег = строка ledger + обновление агрегата в той же транзакции. Нельзя писать `user.balance += x`.

### 4.3 SERIALIZABLE + полный retry

Escrow, пополнение, вывод, settle платежа, admin adjust идут через `withSerializableTransaction`. При `P2034` / `40001` / deadlock транзакция **целиком** повторяется.

Внутри callback **нельзя** звать Telegram, HTTP, sleep. Сначала COMMIT, потом side-effect (outbox).

Порядок локов: Order → Product → Users по id. Иначе дедлоки.

### 4.4 Идемпотентность

Повтор оплаты / webhook / кнопки «купить» не должен создать вторую проводку. Ключ идемпотентности живёт в БД (`IdempotencyRecord` + ключи ledger).

### 4.5 Два токена, две жизни

| | Access | Refresh |
| --- | --- | --- |
| Что это | JWT EdDSA (~15 мин) | 32 случайных байта, в БД только SHA-256 |
| Где лежит | память JS | HttpOnly cookie `__Host-onix_rt` |
| Украли XSS | короткое окно | JS cookie не видит |
| Украли cookie | нужен CSRF-заголовок на refresh | ротация + family revoke |

### 4.6 Refresh rotation + family

Каждый refresh: CAS меняет hash, старый hash пишется в `previousRefreshHash`. Повтор старого токена:

- в окне grace (~30 с, Redis/память) → тот же новый токен (гонка вкладок);
- вне окна → **отзыв всей семьи сессий** (подозрение на кражу).

Не выключай это ради «проще логин».

### 4.7 `sessionVersion` и `permissionVersion` в JWT

`sv` в access сверяется с `User.sessionVersion`. Logout-all инкрементит `sv` — все живые access сразу мертвы, не ждут 15 минут.

`pv` — то же для прав. Не клади массив ролей в JWT.

### 4.8 Privacy-first device id

`deviceId` = HMAC-SHA256(`DEVICE_HMAC_SECRET`, стабильные поля браузера). Не canvas/WebGL. Клиентский `fingerprintHash` игнорируется. В проде `DEVICE_HMAC_SECRET` обязателен, **не** fallback на `JWT_SECRET`.

### 4.9 Telegram outbox после COMMIT

Сначала деньги/сообщение в одной TX с флагом `telegramPushedAt`, потом Bot API. Падение после commit догоняет воркер `telegram-outbox` на той же Neon.

### 4.10 Админка отдельно

`onix-admin/` — свой бандл и своя admin-сессия. Не смешивать с пользовательским JWT «просто поставь isAdmin».

### 4.11 Redis как coordination, не как БД сессий

Сессии в Postgres. Redis: grace refresh, rate-limit, pub/sub realtime между процессами. Без Redis в проде / scale-out процесс не стартует.

---

## 5. Ed25519 — как устроена подпись access

### 5.1 Зачем не `JWT_SECRET` (HS256)

HS256: один секрет и подписывает, и проверяет. Утечка секрета = ковать любые токены.

Ed25519 (в JWT это алгоритм **EdDSA**):

- **приватный** ключ только на API, только подпись;
- **публичный** ключ проверяет подпись (его можно отдавать, ковать токен нельзя);
- в заголовке JWT поле `kid` — какой ключ использовали.

`JWT_SECRET` остался для **legacy** Mini App / старых путей. Auth V2 website **не** подписывает access через HMAC.

Код: `safe-deal-platform/src/auth-v2/token.service.ts`, `signing-key.service.ts`.

### 5.2 Что внутри access JWT

```text
header:  { alg: "EdDSA", typ: "JWT", kid: "<AUTH_ED25519_CURRENT_KID>" }
payload: {
  sub: "<userId как decimal string>",
  sid: "<session uuid>",
  sv:  <User.sessionVersion>,
  pv:  <User.permissionVersion>,
  typ: "access",
  amr: ["telegram"] | ["google"] | ...,
  iss: "onix-api",
  aud: "onix-web",
  iat, exp
}
```

Проверка: alg, kid известен, подпись, typ/iss/aud, exp, затем **живая** Session в БД + `sv` совпал. Украденный JWT с отозванной сессией не проходит.

### 5.3 Refresh — не JWT

`randomBytes(32)` → cookie. В БД `refreshTokenHash = sha256(token)`. Утечка дампа БД не даёт cookie.

### 5.4 Env (имена буквальные)

Текущая подпись (все три обязательны в проде):

```text
AUTH_ED25519_CURRENT_KID
AUTH_ED25519_CURRENT_PRIVATE_PEM
AUTH_ED25519_CURRENT_PUBLIC_PEM
```

Ротация без массового логаута (verify-only, без приватного):

```text
AUTH_ED25519_PREVIOUS_KID
AUTH_ED25519_PREVIOUS_PUBLIC_PEM
```

Формат PEM: PKCS8 private + SPKI public. На PaaS часто one-line с `\n`. Генерация:

```bash
npm run auth:generate-ed25519
npm run auth:generate-ed25519 -- --render
```

Неверные имена (`_PRIVATE_KEY` вместо `_PRIVATE_PEM`) код **не читает**.

### 5.5 Как ротировать (смысл)

1. Старый CURRENT → PREVIOUS (только kid + public).
2. Новый CURRENT (kid + private + public) в том же деплое.
3. Новые access подписываются новым ключом; старые ещё ~15 мин проверяются PREVIOUS.
4. Через час PREVIOUS можно снять.

Ротация Ed25519 **не** убивает refresh-cookie. Ротация `DEVICE_HMAC_SECRET` убивает знакомство устройств (все «новые»). Ротация `PHONE_HASH_SECRET` разрушительнее: хеши не пересчитываются (номер в базе не хранится), поэтому все продавцы теряют верификацию и должны поделиться номером заново.

Другие домены секретов (не мешать):

| Секрет | Зачем |
| --- | --- |
| `DEVICE_HMAC_SECRET` | deviceId |
| `PHONE_HASH_SECRET` | `User.phoneHash` — HMAC номера продавца |
| `JWT_SECRET` | legacy HS256 |
| `PRODUCT_DELIVERY_KEY` | AES-GCM автовыдачи товара |
| `BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` | Telegram |
| `GOOGLE_CLIENT_ID` | проверка aud id_token (секрета Google у нас нет) |

---

## 6. Сессия, cookie, CSRF, вкладки

Cookie refresh:

```text
__Host-onix_rt=...; Path=/; HttpOnly; Secure; SameSite=Lax
```

Локально без HTTPS имя может быть `onix_rt` (`AUTH_COOKIE_SECURE=false`).

**CSRF:** cookie SameSite=Lax не спасает все случаи. Refresh/logout требуют заголовок `X-ONIX-CSRF: 1`. Чужой сайт не может поставить его с cross-site формой.

Один origin = **одна** cookie = один аккаунт на все вкладки. Вход во второй вкладке перезаписывает первую. Фронт слушает `BroadcastChannel` `onix-website-auth` и перегружает профиль, если `sub` в JWT сменился. Это не баг, так устроен браузер.

Гость vs пользователь:

- форма входа только при реальном 401 / явном logout;
- таймаут сети ≠ гость (cookie жива);
- неуспешный Google не должен стирать уже открытую сессию.

Google OAuth: браузер уходит на `accounts.google.com` с параметром
`redirect_uri=https://www.onixtg.shop/auth/google` (`response_type=id_token`).
Google **сверяет эту строку буква в букву** со списком **Authorized redirect URIs**.

В Google Cloud Console у Web client два **разных** списка:

| Поле | Что это | Что должно быть у ONIX |
| --- | --- | --- |
| Authorized **JavaScript origins** | с какого хоста можно начать OAuth | `https://www.onixtg.shop` и `https://onixtg.shop` |
| Authorized **redirect URIs** | куда Google имеет право вернуть токен | **`https://www.onixtg.shop/auth/google`** |

Origins у тебя уже стоят. **Redirect URIs пустые** — поэтому `400: redirect_uri_mismatch`. Origins недостаточно: для этого потока Google требует именно redirect URI.

Нажми **+ Add URI**, вставь ровно:

```text
https://www.onixtg.shop/auth/google
```

без слэша на конце, без `www` vs без `www` путаницы. Save. Подожди 5–15 минут (в консоли пишут, что может быть до нескольких часов). Client secret Google **не нужен**: мы проверяем `id_token` по Client ID.

Не добавляй корень `https://www.onixtg.shop` как единственный redirect: код шлёт путь `/auth/google`. Если добавить только корень — снова mismatch.

Client ID сайт берёт с `GET /api/v2/auth/public-config` (`GOOGLE_CLIENT_ID` в Amvera).

Telegram website: challenge `start` → deep link `?start=login_<id>` (голое `/start` игнор) → webhook → `complete` → та же cookie.

Mini App: отдельный путь `POST /api/auth/telegram-mini` с `initData`.

---

## 7. Безопасность по слоям

**Транспорт:** HTTPS, HSTS на www, серый Cloudflare.

**Заголовки:** Helmet CSP. `script-src` с nonce, **без** `unsafe-eval`. Это правильно: страница не должна выполнять `eval` / `new Function`.

В консоли Chrome ты увидишь два шума, которые **не про ONIX**:

1. Синее **«ВНИМАНИЕ! … Self-XSS»** — стандартный текст Chrome на любом сайте. Он говорит *тебе* не вставлять чужой JS в консоль. Это не ошибка приложения.
2. Красное `content.js` + `unsafe-eval` blocked — **расширение браузера** (adblock, переводчик, «content script») пытается сделать `eval`. CSP сайта это режет. Расширение виновато, не код ONIX. Не добавляй `unsafe-eval` в CSP «чтобы консоль была чистая».

Подробно про origin, Vite, React, Nest: **[урок 31](./31-onix-web-stack-vite-react-nest.md)**.

**IP:** на Amvera (`AMVERA=1`) не доверять `CF-Connecting-IP` / leftmost XFF. `trust proxy 1`, `req.ip`. Клиентский `device.ipAddress` игнор.

**Вход:** rate-limit (Redis). Google id_token проверяется через tokeninfo (iss, aud, exp, verified email). Telegram — подпись бота, не «поверь json с клиента».

**XSS:** access не в storage; cookie HttpOnly; санитизация чата (`sanitizeChatText`). Не вставляй `dangerouslySetInnerHTML` с пользовательским HTML.

**Логи:** `slog` редактит секреты. Не логировать `message.text`, cookie, PEM, refresh.

**Админ:** отдельная сессия, allowlist где есть. Не открывай debug (`ENABLE_DEBUG_ENDPOINTS`) в проде.

**Файлы чата:** R2, не публичный bucket «на всякий».

---

## 8. Escrow коротко

```text
PENDING → оплата/холд → DELIVERING → покупатель complete → COMPLETED
                              ↘ dispute / refund / cancel
```

Автовыдача шифруется `PRODUCT_DELIVERY_KEY`. Ключ расшифровки покупателю — отдельная схема (hotfix 5.5.4.1), не класть секрет в чат plain.

Отзыв: только сделка ≥ 100 ₽, возврат снимает отзыв. Не пересчитывай рейтинг «на глаз» в UI — агрегация на backend.

---

## 9. Как работать самому (ритуал изменения)

1. Прочитай этот урок + `Onix-Notes.md` §0.1 и §0.2.
2. Найди код поиском, не копируй модуль «как в туториале Nest».
3. Деньги / сессии / refresh — сначала тест в `safe-deal-platform/test/` или `onix-frontend` vitest.
4. UI: правь `onix-frontend/src/`, не `public/spa/`.
5. Схема БД: только Prisma migration, на Amvera `migrate deploy` **на старте**, не на build.
6. Коммит в `v1.4-render`. Прод: merge в `v1.4-amvera` (yaml Amvera не выкидывать).
7. Секреты только в панели PaaS, не в git, не в чат.

Локально:

```bash
# API
npm install
npx prisma generate
# DATABASE_URL в .env
npm run start:dev

# SPA
cd onix-frontend && npm install && npm run dev
```

Тесты денег: `npm run test:monetary`.

---

## 10. Карта кода (куда идти)

| Задача | Файлы |
| --- | --- |
| Выдать/проверить access | `auth-v2/token.service.ts`, `signing-key.service.ts` |
| Сессия, rotate, grace | `auth-v2/session.service.ts` |
| Cookie / CSRF | `auth-v2/refresh-cookie.ts` |
| Login Telegram / Google | `auth-v2/auth-orchestrator.service.ts`, `auth-v2.controller.ts` |
| Website клиент сессии | `onix-frontend/src/auth/AuthManager.ts`, `hooks/useOnixCore.ts` |
| Google redirect | `onix-frontend/src/auth/googleOAuth.ts` |
| IP | `http/client-ip.ts` |
| CSP | `security-headers.ts` |
| Redis | `coordination/*` |
| Деньги retry | `database/transaction-retry.ts` |
| Escrow | `escrow.module.ts` |
| Кошелёк | `economy/wallet/` |
| Воркер / Telegram outbox | `worker.main.ts` |

---

## 11. Redis на Amvera (ops, не код)

Сейчас API в Москве ходит в Valkey Франкфурт. Имеет смысл завести Redis в Amvera (внутренний hostname `amvera-…-run-…`, порт 6379, пароль через `REDIS_ARGS=--requirepass …`) и выставить `REDIS_URL` + `COORDINATION_BACKEND=redis`. Neon при этом останется во Франкфурте — это отдельная задержка.

В коде grace refresh сначала читает память процесса, потом Redis — даже до переноса меньше лишних RTT на одной реплике.

---

## 12. Чего никогда не делать

- Хранить access/refresh в localStorage «чтобы не вылетало».
- Отключать rotation / family revoke.
- Писать баланс без ledger.
- Звать Telegram внутри SERIALIZABLE retry.
- Доверять IP с клиента или leftmost XFF на Amvera.
- Упрощать Ed25519 обратно в один `JWT_SECRET` для website.
- Деплоить в `v1.4-amvera` в обход merge с рабочей веткой (кроме yaml Amvera).
- Включать оранжевое Cloudflare на `www`.

Если задача звучит как «давай проще, как обычный JWT в cookie» — сначала этот урок, потом уже код.
