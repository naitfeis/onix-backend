# HOTFIX 5.5.3 — Escrow / Direct Chat / Auto Delivery / Favorites

Перед Этапом 5.6 (WebSocket). Auth V2 / Telegram Login / дизайн не менялись.

## Исправленные проблемы

### Auto Delivery
**Причина:** `EditProduct` не загружал `autoDeliver` и всегда отправлял `autoDeliver: false` → backend очищал AES-GCM ciphertext при любом «Сохранить».
**Исправление:** edit сохраняет/редактирует autoDeliver; пустой `deliveryText` при уже включённой автовыдаче = keep secret; ошибки `PRODUCT_DELIVERY_KEY` → BadRequest; decrypt в purchase с понятной ошибкой. Выдача один раз (`deliveryConsumedAt` + wipe ciphertext).

### Direct Chat
**Причина:** `findFirst` без уникального ограничения + гонки → несколько direct-чатов на одну пару.
**Исправление:** `Chat.pairKey = d:{minUserId}:{maxUserId}` + `@unique`; Serializable create + P2002 fallback; migration дедуплицирует существующие. Escrow/Support чаты (`orderId` / ticket) без `pairKey`.

### Favorites → Purchase
**Причина:** карточки Избранного были display-only (без перехода в product modal).
**Исправление:** клик → `openProductCard(id)` → стандартная карточка Market → `EscrowService.purchase`. `GET /favorites` возвращает тот же `productDto`.

### Public Profile
Убрана кнопка «Купить». Остались: Написать, Подписаться, товары (клик → карточка), отзывы.

### Escrow Filters
Только: Все / Незавершённые (`open` = PAYMENT_HOLD|DELIVERING|DISPUTE) / Завершённые. Сортировки Marketplace убраны из UI сделок.

## Единый Purchase Flow
Все экраны → карточка товара → `core.purchase` → `POST /api/orders/product/:id` → **только** `EscrowService.purchase`.

## Изменённые файлы

**Prisma:** `schema.prisma`, `migrations/20260716020000_stage_5_5_3_direct_chat_pair/`

**Backend:** `engagement.module.ts`, `escrow.module.ts`, `marketplace.module.ts`, `social.module.ts`

**Frontend:** `App.tsx`, `api/contracts.ts`, `utils/productValidation.ts`

## Проверено
npm run build · TypeScript · Prisma · Frontend · Backend · Escrow · Chats · Favorites · Auto Delivery
