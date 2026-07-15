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

## Checklist

✔ TypeScript · ✔ Prisma · ✔ Frontend · ✔ Backend · ✔ Готово к Этапу 5.6
