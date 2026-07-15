# Render startup (NestJS + Prisma)

## Correct commands

| Slot | Command |
| --- | --- |
| Build | `npm ci && npm run build` |
| Pre-Deploy | `npx prisma migrate deploy` |
| Start | `node dist/main.js` |
| Health | `GET` / `HEAD` `/` → `200` `ONIX API` |

**Do not** use Start Command `npx prisma migrate deploy && npm start` — migrate belongs in Pre-Deploy; Start must be a single `node` process.

`WEB_CONCURRENCY=1` is set in `render.yaml`.

Blueprint: repo-root `render.yaml`.
