# Этап 6 — Отзывы, рейтинг, избранное

Статус: готов к ручной проверке (аудит 2026-07-15).

## Архитектура

| Сервис | Модуль | API (без изменений путей) |
| --- | --- | --- |
| `ReviewService` | Engagement | `GET /users/:onixId/reviews`, `POST /orders/:id/reviews` |
| `FavoritesService` | Social | `GET/POST/DELETE /favorites…` |

Публичный API и frontend не менялись.

## Отзывы — правила

1. Заказ существует и `status === COMPLETED`.
2. Автор — `buyerId` или `sellerId` заказа (иначе 404).
3. `subjectId` = контрагент; `authorId === subjectId` запрещён.
4. Один отзыв на пару `(orderId, authorId)` — Prisma `@@unique` + pre-check → `409 Conflict`.
5. Body: только `rating` (1–5) и опциональный `text`.  
   `authorId` / `subjectId` / `orderId` / `createdAt` — только сервер.  
   `User.ratingAverage` / `ratingCount` клиентом не принимаются.

Оба участника сделки могут оставить **по одному** отзыву друг о друге (не «два отзыва от одного автора»).

Удаление/редактирование отзывов **не поддерживается** (нет API).

## Рейтинг

Хранится денормализованно на `User`:

- `ratingAverage` `Decimal(3,2)`
- `ratingCount` `Int`

После create отзыва в той же `Serializable` transaction:

1. `review.aggregate(_avg, _count)` по `subjectId`
2. update user (`average` округляется до 2 знаков)

Нет фиктивных значений: при нуле отзывов average = 0 (только initial default; удалений нет).

Чтение рейтинга на карточках/профиле — из полей User (без N+1 aggregate).

## Избранное

- PK / unique: `@@id([userId, productId])` — дубли невозможны (`upsert`).
- Add: товар должен существовать и `status === ACTIVE` (ARCHIVED / RESERVED / SOLD_OUT → 400).
- List: только свои + ACTIVE, `take: 100`, узкий `select`.
- `userId` всегда `CurrentUser` (path `productId` только).

## Индексы

- `Review`: `@@unique([orderId, authorId])`, `@@index([subjectId, createdAt])`
- `Favorite`: composite PK
- Seller sort by rating: `User.ratingAverage` (marketplace `sort=rating`)

## Безопасность

| Запрещено | Как закрыто |
| --- | --- |
| Отзыв не по своему заказу | participant check |
| Отзыв до COMPLETED | status check |
| Двойной отзыв автора | unique + Conflict |
| Подмена author/subject | server-only fields |
| Прямой ratingAverage/count | нет API |
| Чужое избранное | where userId |
| Избранное несуществующего/архива | pre-check |

## Намеренно без изменений

- UI/UX отзывов и избранного.
- Auth V2 / Telegram.
- Нет delete/patch review.
- Follow/block остаются в `SocialService`.
