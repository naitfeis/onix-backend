# Этап 5 — Чаты и уведомления

Статус: готов к ручной проверке (аудит 2026-07-15).

## Архитектура

HTTP polling сегодня. Домен разделён без смены API:

| Сервис | Ответственность |
| --- | --- |
| `ChatService` | список чатов, direct, история, send |
| `NotificationService` | список / mark read |
| `ReviewService` | отзывы (тот же модуль, смежный engagement) |

Транспорт (HTTP ↔ будущий Socket.io) не входит в сервисы — бизнес-логика готова к подписке на те же операции.

## Модели

- `Chat` — опционально `orderId` (чат сделки создаётся в escrow purchase transaction).
- `ChatMember` — ACL; индекс `userId` для «мои чаты».
- `Message` — `@@index([chatId, createdAt])`; `senderId` только с сервера.
- `Notification` — `@@index([userId, readAt, createdAt])`.

## Поток сообщений

1. Membership check (`ChatMember`).
2. Block check (`UserBlock`).
3. `message.create` + `chat.updatedAt` + `notification(NEW_MESSAGE)` в **одной** `$transaction`.
4. Ответ `messageDto` (`mine` по `viewerId`).

История: `orderBy createdAt desc`, `take ≤ 100`, опциональный cursor `before=<messageId>` (страница старше). Полный scan таблицы запрещён.

## Права доступа

| Операция | Правило |
| --- | --- |
| List / read / send | только `ChatMember` |
| `senderId` | всегда `CurrentUser.id` (нет в body) |
| Direct chat | два участника, `orderId: null` |
| Deal chat | создаётся escrow при purchase (buyer + seller) |
| Notifications list/read | только `userId = CurrentUser` |
| Create notification | **нет** клиентского API |
| Delete message/notification | **нет** API (намеренно) |

## Уведомления

- Источники: message send, escrow, reviews, marketplace (followers) — только backend.
- `GET /notifications` — `take: 100`, `where userId`.
- `PATCH /notifications/:id/read` — `updateMany({ id, userId })` (чужие не затрагиваются).

## WebSocket readiness

Без внедрения WS:

- Сервисы не зависят от Request/Response beyond DTO.
- События уже пишутся в `Notification` + обновляют `Chat.updatedAt` — хук для push/WS fan-out.
- Клиентский polling (`useOnixCore` load chats/messages) можно заменить подпиской, сохранив те же DTO.

## Намеренно без изменений

- UI/UX чатов и уведомлений.
- Auth V2 / Telegram.
- Системное «первое сообщение» при создании чата сделки (не в текущем UX).
- Удаление сообщений/уведомлений (нет продукта).
