# ONIX Stage 5.5 — Trade process, auto-delivery, Telegram Notifications

Additive layer on Escrow + Chats. Does **not** change Auth V2, Telegram Login, or visual design system.

## Auto-delivery

- Product fields: `autoDeliver`, `deliveryCiphertext`, `deliveryIv`, `deliveryConsumedAt`.
- Seller sets write-only `deliveryText` on create/update; stored as **AES-256-GCM** (`PRODUCT_DELIVERY_KEY`, 32-byte base64).
- Secrets are **never** returned in `productDto` / public APIs.
- After purchase (`PAYMENT_HOLD`): if auto-deliver + unused ciphertext → decrypt once → SYSTEM chat message → clear ciphertext/iv → `deliveryConsumedAt` → order → `DELIVERING`, product → `SOLD_OUT`.
- Cannot deliver without payment; cannot re-read ciphertext after consume; no direct “claim delivery” API.

## Support

- `POST /orders/:id/support` — opens `SupportTicket`, adds all `isAdmin || isSupport` users as `ChatMember`, SYSTEM message.
- Works even when order is `COMPLETED`.
- `POST /support/tickets/:id/close` — SUPPORT only.
- Refund: `POST /support/orders/:id/refund` and `POST /admin/orders/:id/refund` via Escrow ledger (incl. COMPLETED clawback). No direct balance edits for refunds.
- Staff role: `User.isSupport` (+ env `SUPPORT_TELEGRAM_IDS`); admins always count as support.

## System messages

- `Message.kind = SYSTEM`, `senderId = null`.
- Purchase creates: order created / do not confirm early / use support.
- Auto-delivery content is also SYSTEM (not seller/buyer).

## Order card in chat

- Chat list includes `orderCard` (id, title, amount, status, escrow) when `chat.orderId` set.
- UI renders it as conversation chrome (not a chat message).

## Subcategories

- Prisma enum `ProductSubcategory` + `catalog.ts` / `GET /products/catalog/subcategories`.
- Validated against `ProductCategory` on create/update/filter.

## Telegram Notifications

- Profile UI tab «Уведомления» removed.
- In-app `Notification` table **kept** for history/analytics.
- Bot pushes (best-effort): new message, purchase, sale complete (money in), refund/dispute, review, support open.
- Requires `BOT_TOKEN` (existing login bot).

## Read receipts

- Opening `GET /chats/:id/messages` marks the thread read via `ChatMember.updateMany` (not per-message).

## Presence (`lastSeen`)

- Touched on `GET /users/me`, chat list, message open.
- FE shows Online / N minutes ago / yesterday via `formatLastSeen`.
- Precise realtime online → Stage 5.6 WebSocket.

## Security checklist

| Check | Status |
| --- | --- |
| Auto-deliver only after paid hold | ✔ |
| One-time secret consume | ✔ |
| No secret in product API | ✔ |
| Chat membership required | ✔ |
| Support joins as ChatMember | ✔ |
| Refund only via Escrow | ✔ |
| Admin cannot rewrite message history | ✔ (no edit API) |

## Performance

- Lists: `take` bounds (chats 50, products limit, notifications 100).
- Product index `[category, subcategory, status]`.
- Selects on chat members / messages.

## Env

```
PRODUCT_DELIVERY_KEY=<32-byte-base64>
SUPPORT_TELEGRAM_IDS=123,456   # optional
BOT_TOKEN=...                  # existing
ADMIN_TELEGRAM_ID=...          # existing
```

## Ready for Stage 5.6

Chat/notification services remain transport-agnostic (HTTP polling today). WebSocket can subscribe to the same domain events without redesigning Auth or Escrow.
