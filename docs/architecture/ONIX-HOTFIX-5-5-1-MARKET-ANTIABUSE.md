# HOTFIX 5.5.1 — Marketplace UX + Anti-Abuse

## Marketplace
- Subcategory chips after category on vitrine; filter via existing `GET /api/products?category=&subcategory=` (Prisma).
- Chip labels wrap (`overflow-wrap`) for Mini App; no design tokens changed.
- Removed Marketplace «Обновить» button (catalog still refreshes via bootstrap / filter effects).

## Chat
- `peerAvatarUrl` on chat list; `sender.avatarUrl` on messages — no extra HTTP calls.

## Anti-Abuse (Risk Score)
- `AbuseMarker` + `SecurityEventType.REGISTRATION_BLOCKED`.
- On admin ban: record fingerprint / browserId / IP / UA markers from recent sessions.
- On **new** Telegram registration: multi-factor score; block only if score ≥ 50 **and** ≥ 2 factors (never IP alone).
- Admin unban revokes that user’s markers.
- Device soft fingerprint + browserId via Website `collectDeviceInfoAsync` (no Mini App–only APIs).

Auth V2 / Telegram Login architecture unchanged (additive hooks only).
