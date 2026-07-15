# ONIX — Telegram Bot Login Chain Break Localization

| Field | Value |
| --- | --- |
| **Date** | 2026-07-15 |
| **Scope** | Backend Telegram Integration diagnostics only |
| **Not changed** | Website, AuthManager, Auth V2, LoginChallenge state machine |

---

## Verdict (first break)

```
Telegram
  ↓  (may never arrive — ops)
Webhook  POST /api/telegram/webhook
  ↓
BotWebhookHandler
  ↓
Repository / Database   ← can succeed (CREATED → OPENED)
  ↓
Bot API sendMessage     ← ★ FIRST IN-CODE BREAK (silent failure)
  ↓
Inline keyboard / Confirm callback   ← never reached if send fails
  ↓
confirmFromBot → CONFIRMED
  ↓
Website poll
```

**Первая точка обрыва в коде:** `Bot API sendMessage`  
(`safe-deal-platform/src/login-challenge/bot-telegram-api.ts`)

До исправления логирования:

1. `BOT_TOKEN` отсутствует → `return false` **без лога**
2. Telegram API error → `response.ok === false` **без чтения `description`**
3. `BotWebhookHandler` **игнорировал** результат и отвечал `{ prompted: true }`
4. В БД challenge уже мог быть `OPENED`, но клавиатуры нет → Confirm невозможен → Website крутит poll (`CREATED`/`OPENED`, не `CONFIRMED`)

Если в логах **нет** `[Bot] webhook hit` — обрыв ещё раньше: **Telegram → Webhook** (webhook не зарегистрирован / неверный URL / secret mismatch / другой бот).

---

## Hop checklist

| Hop | Expected log | If missing |
| --- | --- | --- |
| Telegram → Webhook | `[Bot] webhook hit` | Webhook URL / secret / wrong bot |
| Handler | `[Bot] received /start` | Update format / ignored |
| Parse | `challengeId=` | Payload not `login_<id>` |
| Repository | `[Bot] openForBotPrompt lookup` | Never reached |
| Database | `challenge found` + `status=OPENED` | Wrong id / expired / no row |
| Bot API | `[Bot] sendMessage result` `ok=true` `messageId=` | **★ break** (`BOT_TOKEN`, API error) |
| Callback | `[Bot] callback received` | User never got buttons / webhook dead |
| confirmFromBot | `status before` → `status after=CONFIRMED` | State/error |
| Website | status `CONFIRMED` | Confirm never ran |

Website never sees literal `PENDING` — API returns `CREATED` / `OPENED` / `CONFIRMED` / …  
Poll «висит», пока не `CONFIRMED` (типично застревает на `OPENED` после успешного DB и мёртвого Bot API).

---

## Why Website stays non-CONFIRMED

Confirm path runs **only** on `callback_query` `confirm_login:<id>`.  
If `sendMessage` failed, there is no inline keyboard → no callback → `confirmFromBot` never runs → status never `CONFIRMED`.

---

## Ops verify (read-only)

```bash
# 1) Where does Telegram send updates?
curl "https://api.telegram.org/bot$BOT_TOKEN/getWebhookInfo"

# Must be: https://<your-api-host>/api/telegram/webhook

# 2) After a login attempt, grep API logs:
# [Bot] webhook hit
# [Bot] challenge found
# [Bot] sendMessage result
# [Bot] callback received
# [Bot] confirmFromBot status after
```

---

## Instrumentation added (no rewrite)

- `[Bot] webhook hit` + secret check
- `/start` parse + format mismatch warn
- `openForBotPrompt` lookup/result + id match
- `sendMessage` / `editMessageText` / `answerCallbackQuery` with `ok`, `messageId`, `description`, `botTokenConfigured`
- Explicit **chain break** log when Bot API fails
- `confirmFromBot` status before/after

Files: `bot-webhook.handler.ts`, `bot-telegram-api.ts`, `login-challenge.service.ts` (logs only).
