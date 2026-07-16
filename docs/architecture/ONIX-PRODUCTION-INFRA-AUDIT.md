# ONIX Production Deployment Debug & Infrastructure Audit

| Field | Value |
| --- | --- |
| **Date** | 2026-07-16 |
| **Scope** | Infra / deploy / RU network only — no Auth V2, API contract, or business-logic changes |
| **Frontend** | `https://www.onixtg.shop` (Cloudflare proxied → Vercel) |
| **Browser API** | Same-origin `https://www.onixtg.shop/api/*` → Vercel rewrite → Render |
| **Alias** | `https://api.onixtg.shop` (intended DNS-only → Render) |
| **Render** | `https://onix-api-47tj.onrender.com` |

---

## 1. Render `compression` — root cause

### Symptom

```
safe-deal-platform/src/main.ts(4,25):
Cannot find module 'compression' or its corresponding type declarations. (TS2307)
```

### Why local works, Render fails

| Environment | What happens |
| --- | --- |
| **Local** | `npm install` / prior full install keeps **devDependencies**, including `@types/compression`. `tsc` resolves types via `@types/compression`. |
| **Render** | `render.yaml` sets `NODE_ENV=production`. `npm ci` **omits destinies**. Package `compression` installs (runtime dep), but **`@types/compression` does not**. TypeScript has no typings → TS2307. |

`compression` itself has **no** bundled `.d.ts`. Resolution always needs `@types/compression`.

This matches why Nest builds could succeed before (no `compression` import) and fail only after adding gzip middleware.

### What was fixed

1. Move `@types/compression` → **`dependencies`** (same pattern as `@types/express` already used for Render).
2. Keep `compression` in **`dependencies`**.
3. `render.yaml` buildCommand:

```yaml
buildCommand: npm ci --include=dev && npm run build
```

So `tsc` / Prisma CLI destinies are always present during build even with `NODE_ENV=production`.

4. Bootstrap still:

```ts
if (process.env.NODE_ENV === 'production') {
  app.use(compression());
}
```

### Not a Node 24 / NodeNext bug

Local `tsc --traceResolution` resolves `compression` → `@types/compression/index.d.ts` successfully with `module`/`moduleResolution`: `NodeNext` + `esModuleInterop`. The failure mode is **missing package on disk**, not import syntax.

---

## 2. `api.onixtg.shop` Error 1000 (still)

### Probe (2026-07-16)

| Host | Result |
| --- | --- |
| `www.onixtg.shop/api/health/live` | **200**, TTFB ~430ms |
| `onix-api-47tj.onrender.com/api/health/live` | **200**, TTFB ~390ms |
| `api.onixtg.shop/api/health/live` | **403**, Cloudflare **Error 1000** — DNS points to prohibited IP |

### Why DNS-only alone is not enough

Per [Cloudflare Error 1000](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1000/):

> DNS CNAME to a SaaS that itself uses Cloudflare (Render) → Error 1000 if the **provider has not configured a custom hostname** for your domain. The error can originate from the **provider’s** Cloudflare, not your orange cloud.

Also verify in Cloudflare DNS UI that `api` is truly **DNS only (grey)**. Orange cloud + CNAME to Render CF IPs = classic Error 1000.

### Required ops (no code/architecture change)

1. Cloudflare: `api` → **DNS only**.
2. Render Dashboard → Custom Domains → add **`api.onixtg.shop`** → complete SSL.
3. Confirm `curl https://api.onixtg.shop/api/health/live` → JSON 200.

**Browser Mini App does not need `api.`** — SPA uses same-origin `/api` on `www`. Fix `api.` for webhooks/tools/ops aliases only.

---

## 3. Russia / Telegram `ERR_CONNECTION_RESET`

### Network path (actual browser)

```
RU client / Telegram WebView
  → Cloudflare (proxied www.onixtg.shop)     ← RU ISP throttle risk (CF blog Jun 2025)
  → Vercel (arn1) rewrite /api/*
  → Render Frankfurt (Nest)
  → Neon PostgreSQL
```

### What is NOT the bug

| Signal | Verdict |
| --- | --- |
| `beacon.min.js` `ERR_BLOCKED_BY_CLIENT` | Ad-block / privacy; ignore |
| `web_app_ready` / HapticFeedback 6.0 | Telegram noise; ignore |
| `orders` / `chats` **304** | Conditional cache OK |

### Critical

`GET /api/users/me` → `net::ERR_CONNECTION_RESET`, refresh/me/products **Pending**.

Cause class: **transport reset on the CF→Vercel path under RU conditions**, not Nest business logic. Warm Render health from EU is fine (~300–400ms).

### Code resilience (already + this pass)

- `resilientFetch`: timeout 12s; retry network / 502–504 only; never 401/403.
- GET dedupe for `/api/users/me`.
- **This pass:** Auth V2 refresh transport uses `resilientFetch` (same policy; Auth V2 logic unchanged).

### Cloudflare RU reality

Russian ISP throttling of Cloudflare-protected sites is outside Cloudflare’s control. Keeping **proxied `www`** preserves WAF/CDN (security). Full RU reliability may eventually need a non-CF edge for RU — that would be a product/ops decision, not done here.

---

## 4. Cloudflare / DNS target config

| Record | Target | Proxy |
| --- | --- | --- |
| `onixtg.shop` / `www` | `cname.vercel-dns.com` | **Proxied** |
| `api` | `onix-api-47tj.onrender.com` | **DNS only** + Render custom domain |

**Speed (www):** HTTP/3, HTTP/2, 0-RTT, Early Hints, Brotli — On. Rocket Loader — **Off**.

**Cache Rules:**

- `/assets/*` (+ static ext) → Cache 1 year  
- `/api/*` → **Bypass**

**SSL:** Full (strict preferred once origins valid).

**IPv6:** On unless Telegram Android WebView TLS fails — then test disable.

---

## 5. Render target config

| Item | Value |
| --- | --- |
| Start | `node dist/main.js` |
| Pre-deploy | `npx prisma migrate deploy` |
| Build | `npm ci --include=dev && npm run build` |
| `WEB_CONCURRENCY` | `1` |
| `NODE_ENV` | `production` (runtime) |
| Region | Frankfurt |

Cold start: Starter sleep → first request hundreds of ms–seconds. Mitigate with always-on or health ping.

---

## 6. Measurements (EU probe; RU must re-check after deploy)

| Metric | Before (earlier audit) | After (this probe) | Target |
| --- | --- | --- | --- |
| www TTFB | ~346ms | ~821ms (MISS) | — |
| www `/api/health/live` | ~357ms | ~431ms | warm &lt;300ms |
| Render direct live | ~226–513ms | ~391ms | warm &lt;300ms |
| `api.onixtg` | Error 1000 | **still Error 1000** | 200 after Render custom domain |
| Mini App RU | resets / pending | needs retest post-deploy | &lt;2s first paint |

---

## 7. Verification checklist

- [x] `@types/compression` in **dependencies**; lockfile root lists it  
- [x] `render.yaml` uses `npm ci --include=dev`  
- [x] `npm ci --include=dev`  
- [x] `npm run build`  
- [x] `npx prisma generate`  
- [x] `npx prisma validate`  
- [ ] Render deploy green (push + observe build log)  
- [ ] Render custom domain `api.onixtg.shop`  
- [ ] RU Telegram: no `ERR_CONNECTION_RESET` on `/api/users/me`  
- [ ] Console `[onix-timing]` samples  

---

## 8. WebSocket readiness (not implementing)

| Ready | Note |
| --- | --- |
| Same-origin `/api` + Vite `/ws` proxy (dev) | Keep cookies / Auth V2 |
| Nest keepAlive timeouts | Proxy-friendly |
| resilientFetch | Reuse for WS reconnect backoff later |
| Do **not** attach WS to broken `api.` until Error 1000 cleared |

---

## 9. Summary

| Item | Answer |
| --- | --- |
| **Render compression cause** | `@types/compression` omitted under production `npm ci` (was destinies) |
| **Fixed** | Types → dependencies; `npm ci --include=dev`; lock sync |
| **Local vs Render** | Local had types; Render production install did not |
| **CF / DNS** | www proxied OK; api grey + **must** add Render custom hostname |
| **RU path** | RU → CF www → Vercel → Render; resets = transport/CF path |
| **Architecture** | Unchanged (single-origin `/api`) |
