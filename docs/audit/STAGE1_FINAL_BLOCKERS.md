# Stage 1 — Final Blockers

**Date:** 2026-07-17  
**Stage 2:** blocked until this gate is green

---

## 1. Public profile modal from lot does not close

| | |
|---|---|
| **BUG** | Lot → seller profile → × / Back / Esc does not dismiss profile (or leaves stuck overlay). |
| **CAUSE** | Nested modals (product + profile) shared the same `z-index` and each registered Esc/BackButton independently. Telegram BackButton handlers stacked; body lock / count could desync. |
| **FIX** | Single `modalStack` (`pushModal` / `popModal`): one Esc listener, one BackButton handler, only top modal closes. Layered `z-index = 2000 + depth`. Unique `aria-labelledby` ids. Market: chat/product navigation clears both lot + profile. |
| **TEST** | `design-system/profile-modal-close.test.ts` |

---

## 2. Wallet buttons / modal on profile

| | |
|---|---|
| **BUG** | Вывести / Пополнить appear dead; wallet modal does not show. Public profile must not offer wallet actions. |
| **CAUSE** | Desktop CSS placed both `.balance` blocks on the same grid cell (`grid-row: 1` + `auto` column), overlapping buttons so clicks never fired. Public profile correctly had no wallet buttons (deposit info only). |
| **FIX** | Profile card layout: balances full-width under avatar/main; buttons stay in flow. `Button` defaults to `type="button"`. Wallet modals use Modal stack. Public profile unchanged (no Вывести/Пополнить). |
| **TEST** | `design-system/wallet-modal-open.test.ts` |

---

## 3. Telegram Mini App gray screen / freeze

| | |
|---|---|
| **BUG** | After some use, Mini App freezes (gray, unresponsive). |
| **CAUSE** | (1) Nested modal BackButton / body-lock storms. (2) `OnixBackground` recreated full WebGL context on every `mode` change (tab switch) → GPU pressure in Telegram WebView. |
| **FIX** | Modal stack singleton handlers. WebGL init once (`useEffect([])`), intensity follows `modeRef`. Global `error` + `unhandledrejection` loggers (`installGlobalErrorHandlers`). |
| **TEST** | `design-system/telegram-cleanup.test.ts` |

---

## 4. Group chat add users

| | |
|---|---|
| **BUG** | Could not paste `1 2 3` / `ONIX-1 ONIX-2` / `@u1 @u2`. |
| **CAUSE** | Search treated whole string as one query; UI limited to chip picks. |
| **FIX** | `parseMemberTokens` + «Добавить из поля»; resolve each token via search; toast `ONIX-5 не найден` while keeping found members. Backend `createGroup` skips missing ids and returns `missing[]`; UI cap removed (backend max 200). |
| **TEST** | `design-system/group-chat-users.test.ts` |

---

## 5. Chat search

| | |
|---|---|
| **BUG** | Need ONIX-1 / bare / padded / @nick in list and group add. |
| **CAUSE** | Partially done; multi-token paste broken (see §4). |
| **FIX** | Chat list `q=` + user search strips `@`; lookup candidates on backend. Single-token live search; multi-token uses resolve path. |
| **TEST** | Covered by group-chat-users + existing onix-id backend tests. |

---

## 6. Modal stack audit

| | |
|---|---|
| **BUG** | Lot → profile → chat → back could hang. |
| **CAUSE** | No shared stack; competing overlays. |
| **FIX** | `onix-frontend/src/design-system/modalStack.ts` as the ModalManager. Market clears lot when entering chat from profile. |
| **TEST** | profile-modal-close.test.ts |

---

## Gate commands

```bash
cd onix-frontend && npm test && npm run typecheck && npm run build
npx tsc --noEmit --incremental false
npx tsx --test "safe-deal-platform/test/**/*.test.ts"
```

## Close criteria

| Criterion | Status |
|---|---|
| Profile modal closes from lot | ✅ |
| Wallet modal opens on own profile | ✅ |
| No wallet actions on public profile | ✅ |
| Telegram freeze mitigations | ✅ |
| Group multi-user add | ✅ |
| Cleanup / single BackButton | ✅ |
| Tests | ✅ (run at gate) |

**Stage 2:** do not start until product owner signs off.
