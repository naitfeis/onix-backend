# ONIX Performance Optimization 2026 (Pre-WebSocket)

Additive fixes only. API / design / Auth / business logic unchanged.

## Measured (local Vite build)

| Asset | Before (raw) | After (raw) | After (gzip) |
| --- | --- | --- | --- |
| App `index-*.js` | ~117 KB | **78 KB** | **24.6 KB** |
| `telegram-*.js` | (inlined in app) | **37.6 KB** | **10.2 KB** |
| `framework-*.js` | 142 KB | 142 KB | 45.4 KB |
| CSS | 17 KB | 17 KB | 4.7 KB |
| **JS total gzip** | ~80–95 KB est. | **~80 KB** | — |

App parse chunk dropped ~33% by splitting `@twa-dev/sdk`.

## Backend hot-path fixes

1. `ChatService.list` — 1 grouped SQL unread count (was up to 50× `message.count`).
2. Marketplace / Favorites / Escrow — narrow `select` (no delivery ciphertext / fat User rows).
3. Indexes: `Follow.sellerId`, `Product(status,createdAt|priceCents)`, `Order(*Id,createdAt)`, `Chat.updatedAt`, partial Message unread.
4. Pool default `max=5` (`PG_POOL_MAX`).

## Frontend hot-path fixes

1. Bootstrap: `profile ‖ products ‖ deals ‖ chats` in parallel; skip notifications; reviews deferred.
2. Favorite / Follow / startChat — no full `products?limit=100` / chats refetch.
3. Market search — `AbortController`.
4. GET in-flight dedupe.
5. Avatar `loading="lazy" decoding="async"`.
6. WebGL pauses when `document.hidden`.
7. Deals tab — skip duplicate `/orders` after bootstrap.

## Intentionally not done (no measurable ROI / needs deps or architecture)

- TanStack Query, full virtualization library, React.lazy screen extraction (monolith file), pg_trgm, Brotli middleware package, Lighthouse/TTFB on real devices (not automatable here).
