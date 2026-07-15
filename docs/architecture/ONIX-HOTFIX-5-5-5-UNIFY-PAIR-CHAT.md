# HOTFIX 5.5.5 — Единый чат между пользователями

Перед Этапом 5.6 (WebSocket). Дизайн / Auth V2 / Telegram Login / архитектура Escrow не менялись.

## Проблема

Direct Chat уже использовал `Chat.pairKey`, но `EscrowService.purchase` создавал **новый** чат на каждый заказ (`chat: { create }`). В результате между одной парой пользователей появлялись дубли (direct + N deal-чатов).

## Исправление

1. **Один личный чат на пару** — `pairKey = d:{minUserId}:{maxUserId}` + `@unique`.
2. **`ensurePairChat`** — find/create в Serializable-транзакции (Direct + Purchase + Support fallback).
3. **Покупка** — не создаёт чат; линкует `Order.chatId` к pair-чату и пишет SYSTEM с `Заказ #{id}` + кнопка «Открыть заказ».
4. **Support** — только `ChatMember.upsert` в существующий pair-чат.
5. **Миграция** — объединяет дубли: сообщения, участники/`lastReadAt`, tickets, orders → canonical; удаляет пустые дубли; `Chat.orderId` → `Order.chatId`.

## Схема

- `Chat.orderId` удалён.
- `Order.chatId` → `Chat` (many orders → one chat).

## HOTFIX 5.5.5.1 — migration fix (P3018 / SQLSTATE 21000)

**Причина:** `INSERT INTO ChatMember ... ON CONFLICT DO UPDATE` получал несколько строк с одним `(chatId, userId)` из дубль-чатов одной пары → PostgreSQL: *cannot affect row a second time*.

**Исправление в том же файле миграции:** перед `ON CONFLICT` — `GROUP BY keep_id, userId` + `MAX(lastReadAt)` / `MIN(createdAt)`. Каждый ключ участвует ровно один раз. Идемпотентность: `IF EXISTS` для legacy `Chat.orderId`, `IF NOT EXISTS` / `DROP IF EXISTS` для DDL.

## Checklist

✔ TypeScript · ✔ Prisma · ✔ Frontend · ✔ Backend · ✔ Готово к Этапу 5.6
