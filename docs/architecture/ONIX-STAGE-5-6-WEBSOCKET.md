# Stage 5.6 — WebSocket realtime (slice 1)

HTTP remains source of truth. WS path: `/api/realtime` (same origin).

## Client → server

| Message | Purpose |
| --- | --- |
| `auth { accessToken }` | Required within `REALTIME_AUTH_TIMEOUT_MS` (default 3s) |
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

- HTTP remains the source of truth. Each API process delivers locally and publishes
  a source-tagged envelope through `SharedCoordinationService`. Redis pub/sub
  delivers that envelope to the other processes; the source process ignores its
  Redis echo.
- Development and single-process tests may use the memory adapter. Production,
  `WEB_CONCURRENCY > 1`, and `SCALE_OUT=true` require Redis at startup.
- Limits: `REALTIME_MAX_CONN_PER_USER` (default 5), `REALTIME_MAX_CONNECTIONS` (default 2000).
- Vite proxies `/api` with `ws: true`.
- Open chat also polls HTTP every 4s as a safety net.

## Scale-out runbook

1. Provision a non-evicting Redis/Valkey endpoint reachable by every API replica.
   Store `REDIS_URL` as a deployment secret and set
   `COORDINATION_BACKEND=redis`.
2. Set `SCALE_OUT=true` for externally replicated deployments. Set
   `WEB_CONCURRENCY` to the real number of worker processes when a process
   manager launches multiple workers. These variables enforce safety gates;
   this repository's Node start command does not create workers by itself.
3. Deploy one instance first and require `/api/health/ready` to return 200. The
   readiness check includes both PostgreSQL and Redis coordination health.
4. Before changing traffic, run the isolated Redis drill with a dedicated
   non-production endpoint:
   `REDIS_TEST_URL=<isolated-url> npm run test:realtime-redis`.
5. Start two API instances with distinct `INSTANCE_ID` values. Connect a WS
   client through each instance, authenticate both, trigger an HTTP-backed
   event on instance A, and verify that the client on B receives it once while
   the client on A does not receive a duplicate. Check readiness on both
   instances before enabling normal traffic.
6. Run the guarded connection probe only against an explicitly selected
   environment:
   `WS_LOAD_TARGET_URL=wss://<host>/api/realtime WS_LOAD_ACCESS_TOKEN=<token> WS_LOAD_CONFIRM=onix-websocket-load-test npm run test:load:websocket`.
   It defaults to three connections for ten seconds and sends only auth/ping.
7. Roll back by draining/removing the added replicas and restoring the previous
   `WEB_CONCURRENCY`/`SCALE_OUT` values. Keep Redis configured: production
   deliberately has no memory fallback.

Horizontal scaling on Amvera depends on Amvera providing and routing to external
service replicas. `SCALE_OUT=true` only activates application safety checks; it
does not create an Amvera replica. Confirm replica support and routing with
Amvera before treating this runbook as an available production topology.
