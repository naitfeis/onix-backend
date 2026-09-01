# Урок 31 — веб-стек ONIX: origin, SPA, Vite, React, NestJS

Этот урок объясняет **механику**, а не «фреймворк модный». Без этого легко сломать cookie, Google OAuth и деплой.

Сначала термины браузера, потом инструменты, потом как они склеены в ONIX.

Карта продукта и безопасность: [урок 30](./30-onix-owner-architecture-security.md).

---

## 1. URL: scheme, host, origin, path

Возьми адрес `https://www.onixtg.shop/auth/google`.

| Кусок | Пример | Смысл |
| --- | --- | --- |
| **scheme** (протокол) | `https` | Шифрование. `http` и `https` для браузера — **разные миры**. |
| **host** | `www.onixtg.shop` | Имя машины. `onixtg.shop` без www — **другой host**. |
| **port** | неявно 443 | `https://x:443` и `https://x:444` — разные origin. |
| **origin** | `https://www.onixtg.shop` | scheme + host + port. **Без пути.** |
| **path** | `/auth/google` | Какой документ на этом origin. |
| **query** | `?auth_error=google` | Параметры после `?`. |
| **hash** | `#id_token=...` | Фрагмент после `#`. **Не уходит на сервер** при обычном GET. |

**Origin** — единица доверия браузера. Cookie, `localStorage`, `BroadcastChannel` режутся по origin.

Следствия для ONIX:

- `https://www.onixtg.shop` и `https://onixtg.shop` — два origin. Cookie `__Host-onix_rt` **нельзя** повесить на оба: у `__Host-` запрещён атрибут `Domain`. Поэтому канон один: **www**, apex делает 301.
- `https://www.onixtg.shop/` и `https://www.onixtg.shop/auth/google` — **один origin**, разные path. Cookie на Path=/ видна на обоих.
- Google сравнивает **полный redirect URI** (origin + path), не «сайт в целом».

---

## 2. Same-origin policy (SOP)

Браузер запрещает странице с origin A читать ответы origin B как попало (чужой `fetch` без CORS, чужой DOM iframe).

Это защита пользователя: вкладка `evil.com` не должна читать `fetch('https://www.onixtg.shop/api/users/me')` с твоей cookie.

Исключения, которые люди путают:

- **Форма POST** на другой origin браузер *отправит*, но JS не прочитает ответ. Отсюда CSRF: чужой сайт может дернуть действие, если сервер верит только cookie. Поэтому refresh ONIX требует ещё заголовок `X-ONIX-CSRF: 1`, который чужой странице не поставить осмысленно (и SameSite=Lax режет часть cross-site POST).
- **CORS** — сервер явно разрешает чужому origin читать ответ. В проде ONIX CORS почти не нужен: браузер бьёт в **тот же** origin. Список `CORS_ORIGINS` — страховка и staging, не главная модель.
- **Картинки / скрипты** с другого origin грузить можно (с оговорками CSP). Читать их содержимое JS обычно нельзя.

**Same-origin SPA + API** значит: HTML, JS и `/api` отдаёт **один host**. Для браузера `GET /` и `POST /api/v2/auth/refresh` — один origin. Cookie уходит сама, без `withCredentials` на чужой домен и без rewrite через другой облачный origin.

Как было раньше и почему сломалось: фронт на Vercel, API на Render. Браузер видел два origin (или rewrite через Cloudflare). Из РФ — RST, таймауты, cookie не липла. Сейчас Nest отдаёт и статику, и API с `www.onixtg.shop`.

---

## 3. Что такое SPA

**SPA (Single Page Application)** — после первого `index.html` маршруты рисует JavaScript, без полной перезагрузки документа на каждый клик.

Пользователь открыл `/`, сервер отдал HTML с `<div id="root">` и `<script src="/assets/index-….js">`. Дальше React монтирует дерево компонентов в `root`. Клик «Маркет» / «Профиль» меняет **состояние в памяти**, не обязательно новый HTML с сервера.

Сервер всё равно нужен:

- отдать тот же `index.html` на `/auth/google` (иначе Google вернёт токен на 404);
- отдать `/api/*` с данными и Set-Cookie;
- отдать картинки, шрифты, PWA.

Nest для `/auth/google` специально отдаёт SPA (`spaAuthGoogleCallbackMiddleware`): Google редиректит на этот path, hash с `id_token` остаётся в браузере, JS его читает.

Минусы SPA: первый JS-бандл, SEO слабее, вся логика экрана в клиенте. Плюсы для маркетплейса: чаты, кошелёк, живой каталог без перерисовки всей страницы.

ONIX — SPA, не набор PHP-страниц. Бизнес-правила (деньги, escrow) **не** в React: React только показывает то, что вернул API.

---

## 4. Что делает Vite

**Vite** — инструмент сборки фронта (`onix-frontend/`). Это не сервер продакшена и не React.

### Режим разработки (`npm run dev`)

1. Поднимает свой HTTP (обычно `:5173`).
2. Отдаёт исходники через нативный ESM: браузер грузит `.tsx` почти как модули, Vite на лету компилирует.
3. **HMR**: сохранил файл — подменил модуль без полного reload (состояние React иногда сбрасывается).
4. **Proxy**: запросы `/api` с `:5173` проксируются на Nest `:3000` (`vite.config.ts` → `VITE_API_PROXY_TARGET`). Для браузера origin всё ещё `localhost:5173`, cookie будут на `localhost`, не на www. Это нормально для локалки; `__Host-` на http может быть выключен (`AUTH_COOKIE_SECURE=false`).

Vite **не** выполняет Prisma и **не** проверяет Ed25519. Он только готовит UI.

### Режим сборки (`npm run build`)

1. Rollup склеивает модули в файлы `dist/assets/*.js` с хешами в имени (кэш на год, новый деплой — новое имя).
2. Плагин React превращает JSX в `createElement` / JS.
3. `manualChunks` режет vendor (react) и экраны, чтобы первый экран не тащил чаты.
4. `VITE_*` переменные **вшиваются в бандл в момент build**. На Amvera env панели **нет на шаге build** — поэтому Google Client ID читается runtime с API, а не из `VITE_GOOGLE_CLIENT_ID`.

Собранное копируется в `public/spa/` и **раздаёт Nest**, не Vite. На проде процесса Vite нет.

Если правишь UI — правишь `onix-frontend/src/`. Папка `public/spa/` после чужой сборки устареет, пока не соберёшь снова.

---

## 5. Что делает React

**React** — библиотека UI. Она хранит дерево компонентов и при изменении **state** пересчитывает, какой DOM должен быть, и патчит браузерный DOM.

В ONIX вход: `onix-frontend/src/main.tsx` → `createRoot(...).render(<App />)`.

Типичный цикл:

```text
пользователь нажал «Войти»
  → обработчик (onClick) вызвал startGoogleOAuth
  → ушли с сайта на Google
  → вернулись, useOnixCore restoreWebsiteSession
  → setProfile(user)  // React state
  → App перерисовался: вместо формы — аватар и баланс
```

**Хук** (`useState`, `useEffect`, `useOnixCore`) — функция, которая подписывает компонент на данные. `useOnixCore` — мозг клиентской сессии: refresh, профиль, заказы, чаты.

Чего React **не** делает:

- не хранит деньги;
- не выдаёт JWT;
- не ставит HttpOnly cookie (это умеет только HTTP-ответ сервера);
- не защищает от XSS сам по себе: если вставить HTML пользователя через `dangerouslySetInnerHTML`, XSS будет.

Access-токен живёт в переменной модуля (`memoryAccessToken.ts`), не в React state и не в `localStorage`. Закрыл вкладку — токен из RAM исчез; cookie refresh осталась.

**StrictMode** в dev монтирует эффекты дважды, чтобы ловить грязные побочные эффекты. Bootstrap специально с флагом `coldBootstrapOnce`, чтобы не сделать два refresh подряд.

---

## 6. Что делает NestJS

**NestJS** — серверный фреймворк на Node.js вокруг Express (у ONIX так). Это процесс, который слушает порт (3000 / как скажет PaaS) и отвечает на HTTP.

Слои, которые важно не путать:

| Слой | Файл / идея | Делает |
| --- | --- | --- |
| **Middleware** | `main.ts`, Helmet, www-redirect, SPA google path | До контроллеров: заголовки, редирект apex→www, отдать index.html |
| **Controller** | `auth-v2.controller.ts` | URL → метод. Сам не считает деньги. |
| **Guard** | `AuthV2Guard`, `AuthGuard` | Пускать или 401. Проверяет Bearer EdDSA / legacy. |
| **Service** | `session.service.ts`, `escrow.module.ts` | Бизнес-правила, транзакции. |
| **Prisma** | `prisma/schema.prisma` | SQL к Neon. Не Nest, отдельный клиент. |

Один процесс Nest на проде:

1. Раздаёт файлы из `public/spa/` (JS/CSS/html).
2. Обрабатывает `/api/...`.
3. Иногда воркер — **отдельный** процесс (`worker.main.ts`): outbox Telegram, retention IP. Не путай с HTTP API.

Nest **не** рисует кнопки маркета. Он отдаёт JSON `{ success, data }` / `{ success, error }`. Контракт стабильный: фронт парсит envelope.

`@Public()` на Auth V2 значит: глобальный legacy AuthGuard этот контроллер не блокирует. Защита отдельных методов — свой `AuthV2Guard`.

---

## 7. Как это склеивается на проде

```text
DNS  www.onixtg.shop  →  IP Amvera
                         Nest :3000
                            ├─ GET /                → public/spa/index.html
                            ├─ GET /assets/index-x.js  → бандл Vite
                            ├─ GET /auth/google     → тот же index.html
                            ├─ POST /api/v2/auth/refresh → SessionService
                            └─ GET /api/products    → Prisma
```

Браузер: origin один. JS делает `fetch('/api/v2/auth/refresh', { credentials: 'include' })` — относительный URL, тот же host, cookie уходит.

Локально два процесса (Vite 5173 + Nest 3000) имитируют это **проксированием** `/api`. Это не same-origin в строгом смысле (`localhost:5173` ≠ `localhost:3000`), поэтому для cookie dev ослабляют Secure/имя cookie. Прод так не работает и не должен.

---

## 8. Google Console: origins ≠ redirect URIs

OAuth-клиент типа **Web application**.

**Authorized JavaScript origins** — «с каких страниц можно *начать* вход». Google сверяет `window.location.origin` инициатора. У ONIX: `https://www.onixtg.shop`. Apex тоже можно, мы всё равно редиректим на www.

**Authorized redirect URIs** — «на какие **полные URL** Google имеет право отправить пользователя обратно с токеном». Сюда нужна **точная** строка из запроса `redirect_uri`.

Код ставит:

```text
https://www.onixtg.shop/auth/google
```

Если список redirect URIs **пустой**, Google отвечает `400: redirect_uri_mismatch`. Заполненные JS origins этого не чинят: это другой список.

Добавить URI → Save → подождать. Не путать с Client secret: для implicit `id_token` секрет не используется.

Почему не корень `/`: в консоли `https://www.onixtg.shop/` часто сохраняется как `https://www.onixtg.shop` (срезали слэш). Если приложение шлёт URI со слэшем или с путём — снова mismatch. Путь `/auth/google` Google не срезает.

---

## 9. Консоль Chrome: Self-XSS и content.js

**Self-XSS** — баннер Chrome: не вставляй в консоль код, который прислали в чате. Появляется на google.com и на onixtg.shop одинаково. К CSP ONIX не относится.

**`content.js` + CSP `unsafe-eval`** — у расширения есть файл `content.js`, он пытается выполнить строку как JS (`eval`). CSP страницы (Helmet): `script-src` с nonce, без `unsafe-eval`. Браузер **правильно** блокирует. Лечение: другое расширение или игнор. Лечение «разрешить eval» — дыра XSS.

ONIX специально не даёт `unsafe-eval`: иначе XSS из чата/лота легче выполнить произвольный код.

---

## 10. Короткий чеклист «я понял стек»

- Origin = protocol + host + port, без path.
- Same-origin SPA+API = один host для HTML и `/api`, чтобы `__Host-` cookie жила.
- Vite собирает и в dev проксирует; на проде его нет.
- React рисует UI и держит клиентский state; не является источником денег.
- Nest принимает HTTP, ставит cookie, пишет Postgres; раздаёт собранный SPA.
- Google: два списка. Пустой redirect URI = твой текущий 400.
- Красный `content.js` в консоли ≠ баг бэкенда.

Дальше снова [урок 30](./30-onix-owner-architecture-security.md) — Ed25519, ledger, SERIALIZABLE.
