# Этап 4 — Сделки, гарант, касса (Escrow)

Статус: готов к ручной проверке (аудит 2026-07-15).

## Принцип

Деньги покупателя удерживаются платформой до `COMPLETED`. Продавец получает выплату только после подтверждения получения покупателем. Любое изменение баланса сопровождается записью `LedgerEntry`.

## Соответствие статусов (продукт ↔ Prisma)

| Продуктовый термин | Prisma `OrderStatus` |
| --- | --- |
| CREATED / оплата в сейф | `PENDING` → сразу `PAYMENT_HOLD` при покупке |
| PAID (hold) | `PAYMENT_HOLD` |
| DELIVERED | `DELIVERING` |
| COMPLETED | `COMPLETED` |
| CANCELLED | `CANCELED` |
| DISPUTE | `DISPUTE` |
| REFUND | `REFUNDED` |

Имена enum **не переименовывались** (совместимость API / БД).

## State machine (допустимые переходы)

```
PENDING ──(purchase)──► PAYMENT_HOLD ──(seller deliver)──► DELIVERING ──(buyer complete)──► COMPLETED
                              │                                  │
                              ├──(cancel)──► CANCELED            │
                              ├──(dispute)──► DISPUTE            ├──(dispute)──► DISPUTE
                              └──(admin refund)──► REFUNDED      └──(admin refund)──► REFUNDED
                                                   DISPUTE ──(admin refund)──► REFUNDED
```

Запрещены прямые переходы вроде `PAYMENT_HOLD → COMPLETED`, `DISPUTE → PAYMENT_HOLD`, `COMPLETED → *` (кроме чтения).

Переходы пишутся в `OrderTransition` с уникальным `idempotencyKey`.

## Escrow / касса

| Событие | Баланс покупателя | Баланс продавца | Ledger |
| --- | --- | --- | --- |
| Purchase | −total (hold) | без изменений | `PURCHASE_HOLD` |
| Complete | без изменений | +payout | `SALE_PAYOUT` |
| Cancel / Admin refund | +total | без изменений | `REFUND` |
| Dispute | hold сохраняется | без изменений | — |

Все money-path операции: `prisma.$transaction(..., Serializable)`.

## Права

| Действие | Кто |
| --- | --- |
| Purchase | любой auth; не владелец товара; товар `ACTIVE` |
| Deliver | только `sellerId` из `PAYMENT_HOLD` |
| Complete | только `buyerId` из `DELIVERING` |
| Cancel | участник сделки из `PAYMENT_HOLD` |
| Dispute | участник из `PAYMENT_HOLD` \| `DELIVERING` |
| Admin refund | `isAdmin` |

`buyerId` / `sellerId` / суммы задаются только сервером при create. Body DTO их не принимает.

## Race / идемпотентность

- Резерв товара: `updateMany` где `status=ACTIVE` → `RESERVED` (один победитель).
- Повтор purchase / deliver / complete / cancel / dispute: тот же `idempotencyKey` → replay без повторной выплаты.
- Ledger keys: `order:{id}:payout`, `order:{id}:canceled`, `order:{id}:refunded` — unique.

## API

- `GET /api/orders` — свои сделки (`take: 100`)
- `POST /api/orders/product/:id` — покупка
- `POST /api/orders/:id/deliver`
- `POST /api/orders/:id/complete`
- `POST /api/orders/:id/cancel`
- `POST /api/orders/:id/dispute`
- Admin: `POST /api/admin/orders/:id/refund`

## Намеренно без изменений

- UI/UX сделок (кнопки deliver/complete/dispute; cancel в UI нет — API есть).
- Имена `OrderStatus` / Auth V2 / Telegram.
- Комиссия `feeCents` (по умолчанию 0; `payoutCents = totalAmountCents`).
