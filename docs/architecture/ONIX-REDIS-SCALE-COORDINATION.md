# ONIX Redis scale coordination

The API uses one maintained `redis` client and a shared coordination layer for
state that must be consistent across API processes:

- refresh-token rotation grace (`auth:refresh-grace:*`, TTL-bound);
- realtime fan-out (`channel:realtime`, source instance envelope prevents echo);
- fixed-window limits on Auth V2 and bot-login security endpoints.

## Modes and gates

| Environment | Required backend |
| --- | --- |
| Local development / tests, one process | bounded memory adapter (default) |
| Production | Redis |
| `WEB_CONCURRENCY > 1` or `SCALE_OUT=true` | Redis |

`COORDINATION_BACKEND` accepts `auto`, `memory`, or `redis`. Production and
scale-out startup reject the memory adapter and reject a missing `REDIS_URL`.
The readiness probe checks both PostgreSQL and coordination health.

The memory adapter is deliberately bounded (10,000 entries), TTL-pruned, and
must not be used as a production fallback. Redis failures are surfaced instead
of weakening refresh-reuse handling or silently applying per-instance limits.

## Operations

Set these on the API service:

```text
COORDINATION_BACKEND=redis
REDIS_URL=<secret provider connection string>
```

Keep `REDIS_URL` only in the deployment secret store. Logs expose the selected
backend but never the URL. Use TLS (`rediss://`) when required by the provider.
