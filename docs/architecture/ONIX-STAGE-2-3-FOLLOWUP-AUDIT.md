# Аудит follow-up Этапов 2–3

Дата: 2026-07-15.

## Исправленные проблемы

| Проблема | Решение |
| --- | --- |
| `GET /users/me` не возвращал `bio` после `PATCH` | `bio` в select + `profileDto` |
| `getPublic().products` без `take` | `take: 30`, `orderBy: createdAt desc`, только `ACTIVE` |
| `GET /products/:id` отдавал ARCHIVED чужим | non-ACTIVE только владельцу |
| Favorites / Reviews без `take` | `take: 100` |
| `minPriceCents > maxPriceCents` | `400 BadRequest` |
| Временные `console.log` (API/widget debug) | удалены; `console.error` exception filter сохранён |

## Оставленные без изменений (намеренно)

### `ledgerDto.status = "COMPLETED"`

В Prisma у `LedgerEntry` нет колонки `status`. Записи ledger создаются атомарно и неизменяемы. Поле — **контракт API** для клиентов (не фиктивное состояние БД). UI статус не отображает. Менять schema / убирать поле без миграции клиентов не требуется.

### Identity Link TODO soft-unlink

`TODO(Phase 4)` в `identity-link.ts` документирует отложенную семантику soft-delete. Текущее `deletedAt: null` на login — осознанное поведение Phase 1–3; авторизацию не ломает. Реализацию unlink **не** делать до Phase 4.

### Диапазон цен в UI

`minPriceCents` / `maxPriceCents` работают в Prisma. Контролов в текущем UI нет — UX/дизайн не меняем.

### Owner ARCHIVED в UI «Мои товары»

Публичная витрина — только `ACTIVE`. API `POST .../publish` и `DELETE` (archive) защищены `sellerId`. Отдельного списка ARCHIVED для владельца в UI нет (потребовал бы UX). Owner может читать свой non-ACTIVE через `GET /products/:id`.

### Escrow `orders.findMany` без `take`

Относится к системе сделок — вне follow-up 2–3; не трогали.

## Индексы Marketplace

`Product`: `@@index([category, status, createdAt])`, `@@index([sellerId, status])`, `@@index([title])`. List всегда `where.status = ACTIVE` + `take`/`skip`. Полного scan таблицы нет.

## Безопасность (подтверждено)

- Баланс только в `/users/me` и ledger своего `userId`
- PATCH профиля — только `CurrentUser` + whitelist (`displayName`, `bio`); ONIX ID недоступен
- Товар: create `sellerId = user.id`; update/publish/archive — владелец
- Public profile без `balanceCents`
