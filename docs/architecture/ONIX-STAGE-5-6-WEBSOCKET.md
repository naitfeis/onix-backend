# Stage 5.6 — WebSocket realtime (slice 1)

HTTP remains source of truth. WS path: `/api/realtime` (same origin).

## Client → server

| Message | Purpose |
| --- | --- |
| `auth { accessToken }` | Required within 8s |
| `subscribe_chat { chatId }` | After ChatMember check |
| `typing { chatId }` | Requires prior subscribe |
| `ping` | Keepalive |

## Server → client

| Message | Source |
| --- | --- |
| `chat.message` | `POST /chats/:id/messages` commit |
| `chat.typing` | peer typing |
| `presence` | heartbeat + WS disconnect (broadcast) |
| `notification` | new message / order paid |
| `order.updated` | purchase / deliver / complete / dispute / refund |
| `product.changed` | create / update / archive / purchase reserve |

## Ops

- Single-node only (in-memory bus). Scale-out → Redis (see `ops-gates.ts`).
- Limits: `REALTIME_MAX_CONN_PER_USER` (default 5), `REALTIME_MAX_CONNECTIONS` (default 2000).
- Vite proxies `/api` with `ws: true`.
- Open chat also polls HTTP every 4s as a safety net.
