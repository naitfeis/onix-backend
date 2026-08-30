# Render startup (NestJS + Prisma)

## Correct commands

| Slot | Command |
| --- | --- |
| Build | `npm ci && npm run build` |
| Pre-Deploy | `npx prisma migrate deploy` |
| Start | `node dist/main.js` |
| Health | `GET` / `HEAD` `/` → `200` `ONIX API` |

**Do not** use Start Command `npx prisma migrate deploy && npm start` — migrate belongs in Pre-Deploy; Start must be a single `node` process.

`WEB_CONCURRENCY=1` is set in `render.yaml`. The API also sets
`COORDINATION_BACKEND=redis`; configure `REDIS_URL` as a Render secret.
Startup and `/api/health/ready` fail when shared coordination is unavailable.
The URL must never be committed or printed in logs.

Blueprint: repo-root `render.yaml`.
