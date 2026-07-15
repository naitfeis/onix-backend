# HOTFIX 5.5.4 — Escrow / Chat / Moderation / Marketplace

Перед Этапом 5.6 (WebSocket). Дизайн / Auth V2 / Telegram Login / архитектура не менялись.

## Исправленные проблемы

### 1. Автовыдача при создании товара (критично)
**Причина HTTP 400:**
1. **MarketplaceService** — при `autoDeliver=true` без настроенного `PRODUCT_DELIVERY_KEY` (ключ отсутствовал в `.env.example` / деплое) AES-GCM падал → общий Bad Request.
2. **ValidationPipe** — `deliveryText` был `@IsOptional` даже при `autoDeliver=true`; `quantity` без `@Type(() => Number)`; ошибки без `{ field, error }`.

**Исправление:** `ValidateIf` + обязательный `deliveryText` на create; `@Type`/`@Transform` для quantity/autoDeliver; `fieldBadRequest` / `validationExceptionFactory`; `PRODUCT_DELIVERY_KEY` в `.env.example`.

### 2. Причина блокировки в Mini App
**Причина:** legacy `POST /api/auth/telegram-mini` бросал `UnauthorizedException('Аккаунт заблокирован.')` без `banPublicInfo`.
**Исправление:** тот же `AUTH_ACCOUNT_LOCKED` + `banPublicInfo` (BanResponse), что Web Auth V2; FE `ApiError` переносит `details.ban` → `AuthNotice`.

### 3. SYSTEM-сообщение заказа
Формат с номером заказа и названием товара; кнопка «Открыть заказ» ведёт в конкретный Escrow (`focusDealId`).

### 4. Жалоба на пользователя
`POST /api/users/:onixId/report` → `UserReport` + Telegram админу. UI: Public Profile + Chat.

### 5. Автовыдача после HOLD
Decrypt → SYSTEM (общий notice) + SYSTEM с секретом только покупателю (`Message.visibleToUserId`). Ciphertext wipe / `deliveryConsumedAt`. Секрет не в product API.

### 6. Direct Chat
Повторно подтверждено: `Chat.pairKey` `@unique` + P2002 fallback — ровно один direct chat на пару.

### 7. Избранное → покупка
Профиль загружает `GET /api/favorites` (тот же `productDto`); клик → `openProductCard` → Market modal → `EscrowService.purchase`.

### 8. HTTP 400 JSON
Пример:
```json
{ "success": false, "error": { "field": "deliveryText", "error": "required when autoDeliver=true", "message": "..." } }
```

### 9. Auth 403
`POST /api/v2/auth/refresh` 403 и `telegram-bot/complete` 403 — штатно (`AUTH_ACCOUNT_LOCKED` / `AUTH_CSRF_REJECTED` / просроченная challenge). Не менялось.

## Изменённые файлы

**Prisma:** `schema.prisma`, `migrations/20260716030000_stage_5_5_4_report_visible_msg/`

**Backend:** `main.ts`, `common.ts`, `validation-errors.ts`, `marketplace.module.ts`, `escrow.module.ts`, `engagement.module.ts`, `auth.module.ts`, `social.module.ts`, `.env.example`

**Frontend:** `api/client.ts`, `api/contracts.ts`, `hooks/useOnixCore.ts`, `App.tsx`, `App.css`

## Проверенные сценарии
- Обычный товар / с автовыдачей / без секрета / с секретом
- Ban Web = Mini App DTO
- Purchase → SYSTEM + Открыть заказ
- Report → Telegram admin
- Auto-delivery secret только buyer
- Favorites → purchase
- Direct chat uniqueness (pairKey)

## Checklist
✔ Архитектура · ✔ Типизация · ✔ Prisma · ✔ Frontend · ✔ Backend · ✔ Безопасность · ✔ Производительность · ✔ Документация · ✔ Готово к Этапу 5.6 (WebSocket)
