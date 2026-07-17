# Stage 1 — Bug Fix Gate Report

**Date:** 2026-07-17  
**Scope:** UX, Wallet/Deposit, Chat, Admin ONIX ID, Mini App modal/BackButton  
**Stage 2:** not started

---

## 1. Wallet button order

| | |
|---|---|
| **Bug** | Deposit actions showed Пополнить above/before Вывести. |
| **Cause** | JSX order in `Profile.tsx` balance-actions for deposit. |
| **Fix** | Strict order for both wallets: **Вывести** then **Пополнить**. |
| **Verify** | Profile UI: Баланс and Залог action stacks match. |

---

## 2. Deposit economy (Balance ↔ Deposit)

| | |
|---|---|
| **Bug** | Deposit top-up looked like external payment; withdraw did not always credit main balance. |
| **Cause** | Earlier PaymentIntent path for DEPOSIT; withdraw needed BalanceService credit. |
| **Fix** | `POST /api/wallet/deposit/topup` (alias of `/fund`): BalanceService debit `DEPOSIT_FUND` → DepositService credit available. Withdraw: DepositService debit available → BalanceService credit `DEPOSIT_RETURN`. Locked deposit cannot be withdrawn (`debitAvailable` only). |
| **Verify** | Fund 5000 from 50000 → balance 45000, deposit available +5000. Withdraw available only; locked unchanged. Unit: `deposit-transfer.test.ts`. |

---

## 3. Public trust card

| | |
|---|---|
| **Bug** | Risk of incomplete public deposit/trust payload. |
| **Cause** | N/A — contract already defined. |
| **Fix** | Confirmed `GET /api/users/:onixId/trust-card` returns `depositTotal`, `trustLevel`/`level`, verification badges; never `trustScore` (`assertNoTrustScore`). |
| **Verify** | `economy-foundation.test.ts` public trust card cases. |

---

## 4. Chat stuck on loading + storm of GET /api/chats

| | |
|---|---|
| **Bug** | Network showed many `GET /api/chats` 200s; UI stayed on loading skeleton. |
| **Cause** | `Chats.tsx` `useEffect(..., [chatQuery, core])` called `refreshChats` whenever `core` identity changed. Each load updated state → new `core` → effect again → infinite loop. `load()` set `chats: 'loading'` every time, so UI never settled. |
| **Fix** | Depend only on `searchChats` / `refreshChats` callbacks. Empty query on mount does **not** refetch. Clearing search restores once. Silent chat loads (`silent: true`) so list stays visible. Skeleton only when `loading && chats.length === 0`. |
| **Verify** | Open Chat tab → one bootstrap chats request; no request storm; list renders. |

---

## 5. Chat scroll UX

| | |
|---|---|
| **Bug** | Opening a long thread left viewport at the top. |
| **Cause** | No reliable stick-to-bottom; forced scroll on every length change. |
| **Fix** | On thread open: force bottom. On new messages: auto-scroll only if user is near bottom (~96px). Reading history does not jump. |
| **Verify** | Open thread with many messages → latest visible; scroll up → new message does not yank viewport. |

---

## 6. Read receipts

| | |
|---|---|
| **Bug** | No ✓ / ✓✓. |
| **Cause** | Thread `ChatMember.lastReadAt` existed but was not mapped into message DTO for UI. |
| **Fix** | `messageDto` derives `deliveryStatus: SENT | READ` from peer `lastReadAt >= createdAt`. Staff get `readBy[]` (who/when). UI: ✓ / ✓✓. |
| **Verify** | Send message → ✓; peer opens chat → reload → ✓✓. Admin sees read metadata. |

---

## 7. Group chat + user search

| | |
|---|---|
| **Bug** | No group create / member search. |
| **Cause** | Pair-only chats. |
| **Fix** | `Chat.kind` GROUP + title; `POST /api/chats/groups`; `GET /api/chats/users/search` (ONIX-1 / `@nick`). Toolbar `+` modal. |
| **Verify** | Create group with ONIX-1 + nick hit; thread opens. |

---

## 8. Soft delete

| | |
|---|---|
| **Bug** | No delete / hard delete risk. |
| **Cause** | No soft-delete columns. |
| **Fix** | `Message.deletedAt/deletedById/deletedReason`; `MessageHide` for “у себя”. Global delete: own message or staff. Others see «Сообщение удалено»; staff see original + audit. |
| **Verify** | Delete own → peer placeholder; admin still sees text. Hide for self removes from own feed. |

---

## 9. Admin ONIX ID

| | |
|---|---|
| **Bug** | UI/API showed `ONIX-000007`; ban failed on short id. |
| **Cause** | Exact `where: { onixId }` + padded display. |
| **Fix** | `formatOnixId` in DTOs; `requireUserByOnixId` for ban/adjust; Admin placeholder `ONIX-7 или 7`. Lookup accepts `1` / `ONIX-1` / `ONIX-000001`. |
| **Verify** | Ban with `7` and `ONIX-7`; profile/market show `ONIX-7`. |

---

## 10. Profile modal / Mini App BackButton

| | |
|---|---|
| **Bug** | Modal could leave scroll locked / BackButton flaky when `onClose` identity changed. |
| **Cause** | Effect depended on `onClose`; no body overflow lock. |
| **Fix** | `onClose` via ref; effect deps `[open]` only; `body.overflow = hidden` while modal-open; Esc / backdrop / × / Telegram BackButton. |
| **Verify** | Open/close public profile repeatedly; Back closes modal not app; page scroll restores. |

---

## 11. Auth refresh 401 loops

| | |
|---|---|
| **Bug** | Historical `/api/auth/refresh` storm concern. |
| **Cause** | N/A for current path — Website uses Auth V2 single-flight refresh. |
| **Fix** | Confirmed: `AuthManager` single-flight; website bootstrap never refresh after session 401/guest; AuthManager tests cover storm / definitive logout. Chat storm was unrelated (see §4). |
| **Verify** | `AuthManager.test.ts` refresh-storm cases green. |

---

## Regression commands

```bash
# Backend
npx tsc --noEmit --incremental false
npx tsx --test "safe-deal-platform/test/**/*.test.ts"

# Frontend
cd onix-frontend
npm run typecheck
npm run build
```

**Gate run (2026-07-17):**

| Check | Result |
|---|---|
| Backend `tsc` | ✅ |
| Backend tests | ✅ 102 pass / 0 fail |
| Frontend typecheck | ✅ |
| Frontend build | ✅ |

**Migration required (if not applied):**  
`prisma/migrations/20260717190000_stage1_ux_fix2_deposit_chat`

```bash
npx prisma migrate deploy
```

---

## Close criteria

| Criterion | Status |
|---|---|
| Deposit fund from balance (`POST /wallet/deposit/topup`) | ✅ |
| Deposit withdraw to balance (available only) | ✅ |
| Wallet button order Вывести → Пополнить | ✅ |
| Chat opens without request storm | ✅ |
| Scroll to latest + smart stick | ✅ |
| Read receipts ✓ / ✓✓ | ✅ |
| ONIX-1 display + admin lookup | ✅ |
| Modal + BackButton | ✅ |
| Tests / typecheck / build | ✅ |

**Stage 2:** blocked until product owner confirms this gate.
