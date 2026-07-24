# Chat Attachments v1 — R2 setup

## Env (Nest / Render)

```
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
# optional override:
# R2_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
```

## Cloudflare R2

1. Create a **private** bucket (no public access).
2. Create an API token with Object Read & Write on that bucket.
3. CORS (allow browser PUT from shop + local Vite):

```json
[
  {
    "AllowedOrigins": [
      "https://www.onixtg.shop",
      "https://onixtg.shop",
      "http://localhost:5173"
    ],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "Content-Length"],
    "MaxAgeSeconds": 3600
  }
]
```

## API flow

1. `POST /api/chats/:chatId/attachments/upload-intent`
2. Client `PUT` to presigned URL (opaque key `chat-attachments/{chatId}/{uuid}`)
3. `POST /api/chats/:chatId/attachments/:id/complete` → Message + WS `chat.message`
4. `GET /api/chats/attachments/:id/download` → 60s presigned GET (ChatMember only)

## Limits (v1)

- FREE policy: 20 MB (PRO/ADMIN tiers reserved in code)
- MIME: jpeg/png/webp/gif + pdf/txt
- Cooldown: 1 s between attachment sends
- PENDING cleanup: worker job `chat-attachment-cleanup` (stale > 1h)

## Migrate

```
npx prisma migrate deploy
```
