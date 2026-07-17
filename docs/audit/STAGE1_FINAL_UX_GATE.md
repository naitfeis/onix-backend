# Stage 1 Final UX Bug Fix Gate

**Status:** code complete — Stage 2 not started  
**Date:** 2026-07-17  
**Scope:** UX bug fixes only (no redesign)

---

## Summary

Closed remaining Stage 1 UX blockers: wallet modal positioning, modal stacking for lot → profile, group member add-after-create, soft-delete with long-press menu, chat scroll/receipts/new-message pill, and Mini App freeze guards.

---

## Bugs → root cause → fix

### 1. Wallet modal (Вывод / Пополнение) — wrong position

| | |
|---|---|
| **Bug** | Modal sat low; confirm actions hidden behind Telegram footer / bottom nav. |
| **Cause** | Sheet aligned to bottom; no safe-area / Telegram viewport height; bottom-nav stayed visible. |
| **Fix** | `.modal` centered (`align-items: center`); padding + `max-height` use safe-area and `--tg-viewport-height`; `.modal__body` scrolls; sticky `.modal__actions`; `body.modal-open .bottom-nav { display: none }`; viewport sync in `globalErrorHandlers`. |
| **Check** | Баланс → Вывести / Пополнить; Залог → Пополнить / Вывести. |

### 2. Profile from lot opens wrong

| | |
|---|---|
| **Bug** | Profile too high under header; hard to close; stacked over other modals incorrectly. |
| **Cause** | No single close stack; panels competed for Esc/BackButton. |
| **Fix** | `modalStack` — only top closer runs; z-index `2100 + depth * 10`; Market Lot modal → `PublicProfileModal` as next layer; centered panel + scroll body. |
| **Check** | Lot → Профиль продавца → close profile (lot remains) → BackButton / × / Esc. |

### 3. Group chats — add members after create

| | |
|---|---|
| **Bug** | Could create a group but not add people later. |
| **Cause** | No API/UI for post-create membership. |
| **Fix** | `POST /api/chats/:id/members` (`ChatService.addMembers`); open group header `+` → modal «Добавить участников»; tokens `1 2 3` / `ONIX-1` / `@nick` via `parseMemberTokens`. |
| **Check** | Create group → open → `+` → add one/many IDs. |

### 4. Message delete (Telegram-like)

| | |
|---|---|
| **Bug** | Only inline delete links; no soft-delete semantics for «у всех». |
| **Cause** | UI incomplete; `deletedForAll` not set on global soft-delete. |
| **Fix** | Long-press / context menu: «Удалить у меня» / «Удалить у всех»; self always; global only own unless admin/support; DB soft fields `deletedAt`, `deletedById`, `deletedForAll` + audit log; no hard delete. |
| **Check** | Long-press own message; staff can delete any; staff still see original via audit fields in DTO. |

### 5. Chat UX

| | |
|---|---|
| **Bug** | Jump on history scroll; no new-message cue; receipts unclear. |
| **Cause** | Always scrolled; no stick-to-bottom gate; no pending counter. |
| **Fix** | Stick-to-bottom on open / when near bottom; pill `↓ Новые (N)` when scrolled up; ✓ / ✓✓ from `deliveryStatus` (`SENT` / `READ`). |
| **Check** | Open chat → bottom; scroll up → receive → pill; send → ✓ then ✓✓ after peer read. |

### 6. Telegram Mini App freeze

| | |
|---|---|
| **Bug** | Freeze on profile/chat/modal/tab switch. |
| **Cause** | Remount loops, chat search refetch on every core change, WebGL recreate, unhandled errors, viewport resize. |
| **Fix** | Chat search effect not tied to whole `core`; `OnixBackground` WebGL once; `installGlobalErrorHandlers` (`error` / `unhandledrejection` / Telegram `viewportChanged` + resize); modal stack body lock. |
| **Check** | Lot → profile → close; open chat; switch tabs — no hang. |

---

## Automated tests

### Frontend (`onix-frontend`)

```text
npm run typecheck  ✅
npm test           ✅ 70 tests
npm run build      ✅
```

Relevant: `profile-modal-close`, `telegram-cleanup`, `wallet-modal-open`, `group-chat-users`, `contracts` (add members / delete paths).

### Backend (repo root)

```text
npm run typecheck  ✅
npm test           ✅
```

---

## Manual checklist (pre–Stage 2)

- [ ] Профиль из лота
- [ ] Закрытие профиля (лот остаётся / BackButton)
- [ ] Вывод баланса
- [ ] Пополнение баланса
- [ ] Залог (пополнить / вывести доступное)
- [ ] Групповые чаты
- [ ] Добавление участников (`+` в группе)
- [ ] Удаление сообщений (long-press)
- [ ] Telegram BackButton (только верхний слой)
- [ ] Нет зависаний Mini App

---

## Gate rule

**Stage 2 не начинать**, пока все пункты ручного чеклиста не зелёные.

---

## Follow-up (2026-07-17 evening)

| Bug | Fix |
|---|---|
| Modal at page top after tab scroll | `Modal` → `createPortal(document.body)`; fixed overlay uses `--tg-viewport-height` |
| Profile × from lot dead | Same portal + explicit `modal__close` stopPropagation |
| Chat → profile | Avatar / nick / last-seen as one `conversation__peer` control |
| Online green dot | `UserAvatar online` + `isOnline()` (~2 min) |
| Delete for all | Sender or **admin only** (support cannot) |
