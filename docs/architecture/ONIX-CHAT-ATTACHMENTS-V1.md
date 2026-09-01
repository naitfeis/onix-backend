# Chat Attachments v1

**Status (2026-09):** code lives in `safe-deal-platform/src/chat-attachments/`.
Uploads work only when Amvera/Render has `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Otherwise API returns that uploads are
unavailable. Browser PUT to R2 is Cloudflare — may fail from Russia.

Older note (kept for history): the feature was parked until R2 existed; do not
treat the next paragraph as current wiring.

Draft implementation (historical):

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
