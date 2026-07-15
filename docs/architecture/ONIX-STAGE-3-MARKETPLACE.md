# Этап 3 — Marketplace, карточки, поиск, фильтры

Статус: готов к ручной проверке (аудит 2026-07-15).

## Границы этапа

В scope: каталог товаров, CRUD лота (создание / обновление / архивация-публикация), карточка товара, поиск, фильтры и сортировка.

Вне scope: Auth V2, сделки/escrow (Этап сделок), UI/дизайн, Prisma schema без необходимости.

## Данные (PostgreSQL / Prisma)

| Поле | Источник |
| --- | --- |
| Товар | `Product` |
| Продавец | `User` через `include.seller` |
| Избранное | `Favorite` (scoped по `userId`) |
| Статус витрины | всегда `ACTIVE` в `GET /api/products` |

Нет полей изображений и просмотров в схеме — карточка не показывает mock-картинки/views.

## API

| Метод | Назначение | Права |
| --- | --- | --- |
| `GET /api/products` | Список + фильтры | Auth; Prisma |
| `GET /api/products/:id` | Карточка | Auth |
| `POST /api/products` | Создание (ACTIVE) | Auth; `sellerId = CurrentUser` |
| `PATCH /api/products/:id` | Обновление | Только владелец, ACTIVE/ARCHIVED |
| `POST /api/products/:id/publish` | Публикация | Только владелец |
| `DELETE /api/products/:id` | Архивация | Только владелец; не RESERVED |

### Query `GET /api/products`

- `search` — case-insensitive по title / telegramNick; exact ONIX ID; пустая строка не передаётся
- `category` — `ProductCategory`
- `minPriceCents` / `maxPriceCents` — Prisma range; при `min > max` → 400 (UI контролов пока нет)
- `sort` — `newest` \| `price_asc` \| `price_desc` \| `rating`
- `limit` (1–100, default 30), `offset` (0–10000)

`GET /api/products/:id`: `ACTIVE` — всем; non-ACTIVE — только владельцу.

Комбинации фильтров применяются в одном Prisma `where`. SQL-инъекции исключены (параметризованный Prisma). Mass assignment закрыт DTO + `forbidNonWhitelisted`.

## Frontend

- Витрина вызывает `listProducts` → Prisma (debounce поиска 300 ms).
- Bootstrap профиля держит отдельный `products?limit=100` для «Мои товары» / избранного в профиле (не затирается поиском витрины).
- UI контролов не менялся: поиск, чипы категорий, select сортировки.

## Безопасность

Чужой товар нельзя обновить / архивировать / опубликовать (`sellerId` check → 404).
