# Chat Attachments v1 — NEXT STAGE (not active)

**Status:** parked. Do not enable until Cloudflare R2 is provisioned and core ONIX chat is stable.

Draft implementation lives in-repo but is **not wired**:

- `safe-deal-platform/src/chat-attachments/` (excluded from `tsc`)
- `safe-deal-platform/src/workers/jobs/chat-attachment-cleanup.job.ts` (excluded)
- Plan: `.cursor/plans/chat_attachments_v1_*.plan.md`

## Why parked

Shipping attachment schema/`include: { attachment }` without an applied migration broke `GET /chats/:id/messages` (empty thread UI while chat list still showed previews). R2 is not connected yet.

## When re-enabling

1. Restore Prisma models (`ChatAttachment`, `Message.contentType`) + migration
2. Import `ChatAttachmentsModule` in `app.module` / worker
3. Configure R2 env + private bucket CORS
4. Re-enable FE paperclip + `sendChatAttachment`
5. Flow: `upload-intent` → PUT R2 → `complete` (idempotent) → `chat.message` WS

See plan for security (magic bytes, 20 MB FREE policy, opaque keys, PENDING cleanup).
