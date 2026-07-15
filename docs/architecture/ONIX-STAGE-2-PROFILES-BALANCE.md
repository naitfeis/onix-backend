# Этап 2 — Профили, ONIX ID, Баланс

Статус: готов к ручной проверке (аудит 2026-07-15).

## Границы этапа

В scope: профили (`GET/PATCH /users/me`, публичный `GET /users/:onixId`), ONIX ID, баланс `User.balanceCents`, ledger (`GET /wallet/ledger`, записи через escrow/withdraw/admin).

Вне scope: Auth V2, Telegram/Bot Login, UI/дизайн, marketplace escrow UI beyond balance display.

## Данные (PostgreSQL / Prisma)

| Сущность | Источник истины |
| --- | --- |
| Профиль | `User` (`displayName`, `bio`, `avatarUrl`, `telegramNick`, …) |
| ONIX ID | `User.onixId` `@unique` — выдаётся при создании, не в `UpdateProfileDto` |
| Баланс | `User.balanceCents` |
| История | `LedgerEntry` (`userId`, `type`, `amountCents`, `balanceAfterCents`, `idempotencyKey`) |

## Backend

- `ProfilesService.getMe` — только `CurrentUser.id`; баланс + ledger (take 100) в транзакции.
- `ProfilesService.update` — whitelist: `displayName`, `bio` (`forbidNonWhitelisted`).
- `ProfilesService.getPublic` — без `balanceCents`; seller id из БД.
- `ProfilesService.ledger` — `where: { userId: user.id }`.
- Вывод: `POST /wallet/withdrawals` — только свой `user.id` + идемпотентность.
- Корректировка баланса: `POST /admin/users/:onixId/balance` + `AdminGuard`.

## ONIX ID

Генерация (auth / IdentityService): `PENDING-{telegramId}` → `ONIX-{id.padStart(6,'0')}`. Уникальность на уровне Prisma/Postgres. Клиент не может изменить через PATCH.

## Frontend

- Профиль/баланс/ONIX ID: `GET /api/users/me` (`useOnixCore.loadProfile`).
- `walletHistory` приходит в ответе `/me` (без дублирующего запроса ledger).
- Ошибки через `friendlyError`; баланс отображается из `profile.balanceCents` (строка cents с API).

## Безопасность (Этап 2)

- Чужой профиль с балансом недоступен через public endpoint (баланс не отдаётся).
- Чужой баланс нельзя изменить без admin.
- ONIX ID нельзя сменить через API профиля.
