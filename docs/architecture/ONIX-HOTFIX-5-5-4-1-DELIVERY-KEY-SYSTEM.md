# HOTFIX 5.5.4.1 — Auto Delivery key + SYSTEM order message

## 1. PRODUCT_DELIVERY_KEY

**Причина:** ключ отсутствовал в локальном `.env` / Render Environment → AES-GCM отказывал при `autoDeliver=true`.

**Исправление (криптографию не меняли):**
- `env.ts` — загрузка `.env` из cwd/repo root (`override: false`, Render env приоритетнее)
- startup log: OK / missing / invalid
- понятная 400 при отсутствии ключа
- `.env.example` + комментарии для Render Dashboard → Environment → Redeploy
- `dotenv` как прямая зависимость

При валидном `PRODUCT_DELIVERY_KEY` (32-byte base64) автовыдача работает как раньше.

## 2. SYSTEM после покупки

В той же Serializable-транзакции, что order + escrow chat:
1. одно SYSTEM «Заказ создан…» (обычная покупка и автовыдача)
2. при автовыдаче — дополнительные SYSTEM (notice + секрет buyer-only)

FE: `deal.chatId` → после покупки открывается чат сделки; кнопка «Открыть заказ» → конкретный Escrow.

## Файлы

`env.ts`, `main.ts`, `delivery-crypto.ts`, `marketplace.module.ts`, `escrow.module.ts`, `response.ts`, `.env.example`, `package.json`, `contracts.ts`, `useOnixCore.ts`, `App.tsx`
