# HOTFIX 5.5.2 — Marketplace UX, Public Profile, Refund, Moderation

Перед Этапом 5.6 (WebSocket). Auth V2 / Telegram Login / дизайн не переписывались.

## Исправленные проблемы

| Область | Было | Стало |
|--------|------|--------|
| Public Profile | Упрощённая карточка | Полноценный профиль как личный (без баланса / ledger / истории сделок) |
| Reviews | Любая сторона сделки | Только покупатель → продавец (`buyerId === author`) |
| Auto-follow | — | После сделки подписка **не** создаётся (только вручную) |
| Telegram Bot | Только in-app notify | + push подписчикам при ACTIVE товаре (Bot API, без polling) |
| Ban | `deletedAt` toggle | Причина + комментарий + срок; UI для заблокированного |
| Admin badge | Нет | Жёлтый `ADMIN`/`SUPPORT` в чате, профиле, карточках |
| ONIX в чате | Текст | `ONIX-######` → ссылка на Public Profile |
| Favorites | ACTIVE filter, orphan rows | При ARCHIVE — `favorite.deleteMany` |
| Refund | Только support после COMPLETED | Seller `refund-request`; held → auto; COMPLETED → clawback + reason + audit |
| Orders | Без фильтров | Prisma `sort` + `status` на `GET /orders` |

## Архитектурные изменения

### Public Profile — `GET /api/users/:onixId`
Аватар, ONIX ID, имя, рейтинг, продажи, подписчики, follow, bio, `createdAt`, lastOnline, ACTIVE товары, отзывы. Без balance / ledger / deal history.

Точки входа: Marketplace, карточка товара, чат, поиск ONIX ID, отзывы, linkify в сообщениях.

### Ban policy — `ban-policy.ts`
| Reason | Срок |
|--------|------|
| `MISCONDUCT` | 7 дней |
| `THIRD_PARTY_ADS` | 30 дней |
| `OFF_PLATFORM_DEAL` | Навсегда |
| `FRAUD` | Навсегда |
| `OTHER` | `durationDays` 1–3650 |

`AUTH_ACCOUNT_LOCKED.details.ban` отдаёт причину, комментарий, дату окончания, remaining / «Постоянная блокировка».
Истёкший бан снимается при логине / validateAccess (additive, без смены Auth V2).

### Favorites policy (единое поведение)
**Архивный товар автоматически удаляется из избранного** (`deleteMany` при ARCHIVE).  
Список `GET /favorites` и витрина показывают только `ACTIVE`. Финансовая модель (escrow / ledger) не затрагивается.

### Seller refund — `POST /api/orders/:id/refund-request`
- `PAYMENT_HOLD | DELIVERING | DISPUTE` → Escrow refund автоматически.
- `COMPLETED` → clawback с баланса продавца + credit покупателю через Ledger; reason обязателен; audit `sellerInitiated`.
- Support/admin пути без изменений (тот же Escrow).

### Orders filters — `GET /api/orders?sort=&status=`
- sort: `newest` \| `oldest` \| `expensive` \| `cheap`
- status: `active` \| `completed` \| `canceled` \| `dispute` \| `archive` (`CANCELED|REFUNDED`)

## Безопасность
- Ban только admin; comment + reason обязательны.
- Reviews: роль сделки (buyer), не UI-флаг.
- Refund COMPLETED: только seller или support; ledger clawback Serializable.
- Public profile без приватных полей.
- Soft-ban + risk markers (5.5.1) сохранены.

## Производительность
- Telegram push: `Promise.allSettled`, cap 500 followers, fire-and-forget после commit.
- Favorites purge на archive — один `deleteMany`.
- Orders filters — Prisma `where`/`orderBy`, take 100.
- ONIX linkify — client-only; профиль кэшируется в модалке без лишнего refetch.

## Изменённые файлы (ключевые)

**Backend:** `ban-policy.ts`, `operations.module.ts`, `profiles.module.ts`, `response.ts`, `engagement.module.ts`, `marketplace.module.ts`, `domain-notify.ts`, `escrow.module.ts`, `social.module.ts`, `auth-v2/identity.service.ts`, `auth-v2/session.service.ts`, `prisma/schema.prisma`, migration `20260716010000_stage_5_5_2_ban_public`

**Frontend:** `api/contracts.ts`, `hooks/useOnixCore.ts`, `App.tsx`, `App.css`, `auth/v2AuthApi.ts`

**Docs:** этот файл

## Готовность к 5.6
HTTP-домен стабилен; presence/chat уже heartbeat-ready. WebSocket (5.6) может подключить transport без смены DTO публичного профиля / escrow.
