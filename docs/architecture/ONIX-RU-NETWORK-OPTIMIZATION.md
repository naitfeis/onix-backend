# ONIX Production Network Optimization — Russia / Telegram Mini App

| Field | Value |
| --- | --- |
| **Date** | 2026-07-16 |
| **Scope** | Infrastructure + performance only (no Auth V2 / design / API contract changes) |
| **Public origin** | `https://www.onixtg.shop` (Cloudflare → Vercel) |
| **API path (browser)** | Same-origin `www.onixtg.shop/api/*` → Vercel rewrite → Render |
| **Render** | `https://onix-api-47tj.onrender.com` (Frankfurt) |

---

## 1. Root cause of delay

### Critical (blocking)

| Finding | Evidence | Impact |
| --- | --- | --- |
| **`api.onixtg.shop` Cloudflare Error 1000** | `DNS points to prohibited IP` — orange-cloud A/CNAME to Render (Render already sits behind Cloudflare IPs) | Any client still calling `api.onixtg.shop` gets **403 HTML**, not JSON. Causes `ERR_CONNECTION_RESET` / failed fetch in Telegram WebView. |
| **Russia × Cloudflare throttling** | [CF blog Jun 2025](https://blog.cloudflare.com/russian-internet-users-are-unable-to-access-the-open-internet/): RU ISPs throttle CF-protected sites (~16 KB / connection resets) | First-byte + asset load unstable in RU Chrome / Telegram WebView even when origin is healthy. |
| **Long hop chain** | RU → Cloudflare → Vercel `arn1` → Render `frankfurt` → Neon | Extra RTT on every API call; cold Render adds hundreds of ms. |

### Secondary (code / edge)

| Finding | Status before | Fix |
| --- | --- | --- |
| Auth then parallel data | Already parallel after auth; `Promise.all` failed whole bootstrap on one reject | `Promise.allSettled` |
| No fetch timeout / retry | Hang / single fail on reset | `AbortController` + retry 502/503/network only |
| Nest no compression / keepAlive | Larger payloads, proxy idle closes | `compression` + HTTP keepAlive timeouts |
| `index.html` debug logs | Extra work before paint | Removed; early `Telegram.WebApp.ready()/expand()` |
| Static cache | Default Vercel | `/assets/*` 1y immutable |

### Baseline metrics (probe from EU / Tallinn CF-RAY `TLL`, 2026-07-16)

| Target | HTTP | DNS | TLS | TTFB | Notes |
| --- | --- | --- | --- | --- | --- |
| `www.onixtg.shop` | 200 | 80ms | 166ms | **346ms** | CF + `X-Vercel-Cache: HIT`, `alt-svc: h3` |
| `www.onixtg.shop/api/health/live` | 200 | 13ms | 131ms | **357ms** | Rewrite → Render |
| `www.onixtg.shop/api/health/ready` | 200 | — | — | **270ms** | DB ok |
| `onix-api-47tj.onrender.com/api/health/live` | 200 | — | — | **226–513ms** | Warm vs cooler |
| **`api.onixtg.shop/api/health/*`** | **403** | — | — | 334–749ms | **CF Error 1000** |

> RU Telegram / Chrome numbers must be re-measured from a Russian exit IP after Cloudflare DNS fix. EU probe is not a Russia substitute.

---

## 2. What changed in code

### Frontend (`onix-frontend`)

- `index.html` — early Telegram `ready()`/`expand()`, dns-prefetch/preconnect to `www`, removed debug `console.log`
- `src/api/fetchResilience.ts` — timeout 12s, retry network / 502–504 (never 401/403)
- `src/api/client.ts` — uses resilient fetch; keeps GET dedupe; records API timing
- `src/hooks/useOnixCore.ts` — `Promise.allSettled` for profile/products/orders/chats; timing marks
- `src/perf/timing.ts` — navigation TTFB + API latency logs (`[onix-timing]`)
- `vercel.json` — long-cache static `/assets` + images; rewrite unchanged

### Backend (`safe-deal-platform`)

- `main.ts` — gzip compression, request timing headers, HTTP keepAlive/headers/request timeouts, single process unchanged
- `prisma.service.ts` — pool `keepAlive`, configurable idle/connection timeouts
- `marketplace.module.ts` — public catalog `Cache-Control: public, max-age=300, stale-while-revalidate=3600`; products `private, no-store`
- `profiles` / `orders` / `chats` — `Cache-Control: private, no-store`
- `request-timing.middleware.ts` — `Server-Timing` / `X-Response-Time`; warn ≥800ms
- `render.yaml` — already `node dist/main.js`, `WEB_CONCURRENCY=1` (unchanged)

**Not changed:** Auth V2, Telegram Login flow, API DTOs, UI design, business logic.

---

## 3. Cloudflare settings (manual — dashboard)

Apply in Cloudflare for zone `onixtg.shop`:

### Speed (enable)

| Setting | Value |
| --- | --- |
| HTTP/3 (QUIC) | On |
| 0-RTT Connection Resumption | On |
| Early Hints | On |
| Brotli | On |
| Auto Minify JS/CSS/HTML | On |
| Browser Cache TTL | Respect Existing Headers (or ≥4h for static) |
| Always Online | On |
| HTTP/2 | On |
| HTTP/2 to Origin | On |

### Do **not** enable

| Setting | Why |
| --- | --- |
| **Rocket Loader** | Breaks React/Vite module loading |

### DNS / Proxy

| Host | Proxy | Action |
| --- | --- | --- |
| `www` | **Proxied (orange)** | Keep — CDN for SPA |
| `api` | **DNS only (grey)** or delete | **Required** — currently Error 1000. Browser SPA does **not** need `api.`; webhook stays on `*.onrender.com`. Point grey `api` A/CNAME at Render only if you need a human-readable alias. |

### Cache Rules

1. **Static** — URI Path matches `/assets/*` OR file extension `js|css|svg|webp|avif|woff2` → Cache Eligible, Edge TTL 1 year, Browser TTL 1 year.
2. **API bypass** — URI Path starts with `/api/` → Bypass cache (origin `Cache-Control` still applies for browser on public catalog).

### Russia / IPv6

| Item | Guidance |
| --- | --- |
| Regional Services | Enterprise-only; N/A on typical plans |
| IPv6 | If Telegram Android WebView fails TLS: Network → disable IPv6 Compatibility **or** remove AAAA for grey `api` (IPv4-only) |
| RU CF throttle | Outside Cloudflare control. Fallback if RU remains broken: grey-cloud `www` → Vercel directly (lose CF WAF) **or** RU-friendly edge in front of Vercel |

---

## 4. Render settings

| Item | Value |
| --- | --- |
| Region | Frankfurt (existing) |
| Start | `node dist/main.js` (one process) |
| `WEB_CONCURRENCY` | `1` |
| Health | `/` + `/api/health/live` / `ready` |
| Optional env | `HTTP_KEEPALIVE_TIMEOUT_MS=65000`, `PG_POOL_MAX=5`, `PG_IDLE_TIMEOUT_MS=30000` |
| Cold start | Starter plan sleeps — consider **always-on** or external ping to `/api/health/live` every 5 min |

---

## 5. API latency before / after

| Path | Before (EU probe) | After (code) | Expected after CF `api` fix + deploy |
| --- | --- | --- | --- |
| Health via www rewrite | 270–357ms TTFB | Same path + gzip + timing headers | ≤300ms warm target |
| `api.onixtg.shop` | **403 Error 1000** | Ops: DNS only | Should match Render direct (~225ms warm) **or** unused |
| First authenticated API | Depends on RU path | Retry on reset; dedupe `/users/me` | Goal: **&lt;300ms** warm from RU edge |

---

## 6. Telegram Mini App startup before / after

| Phase | Before | After |
| --- | --- | --- |
| `ready` / `expand` | After React + SDK mount | **Inline in `index.html`** + again in hook |
| Shell UI | Skeletons while loading | Unchanged (non-blocking) |
| Bootstrap data | `Promise.all` | `Promise.allSettled` (partial success) |
| Network | No timeout/retry | 12s timeout, 2 retries on reset/502/503 |
| Goal | — | Open &lt;2s; first API &lt;300ms warm |

Measure in RU Telegram: DevTools → `[onix-timing] ttfb`, `api:…`, `bootstrap-settled`.

---

## 7. Prepared before WebSocket

| Ready | Notes |
| --- | --- |
| Single-origin `/api` rewrite | Cookies / Auth V2 stay same-site |
| GET dedupe + resilient fetch | Less stampede on reconnect |
| HTTP keepAlive on Nest | Stable long-lived connections under proxy |
| Vite `/ws` proxy (dev) | `vite.config.ts` already proxies `/ws` |
| Compression + timing | Baseline for comparing WS upgrade cost |
| `api.onixtg.shop` grey-cloud | Avoid CF 1000 before any WS hostname |

**Next (not in this change):** WS endpoint on Render, Vercel rewrite or direct Render host, heartbeat, reconnect with same retry policy — do **not** put WS behind broken orange `api.` host.

---

## 8. Verification checklist (RU)

- [ ] Cloudflare: `api` DNS only / Error 1000 gone
- [ ] Speed toggles on; Rocket Loader off
- [ ] Cache rules: static 1y, `/api` bypass
- [ ] Deploy frontend (Vercel) + API (Render)
- [ ] Chrome RU: TTFB www, `/api/health/live` &lt;300ms warm
- [ ] Telegram Mini App RU: open &lt;2s, no `ERR_CONNECTION_RESET`
- [ ] Console: `[onix-timing]` samples present
- [ ] `GET /api/products/catalog/subcategories` returns `Cache-Control: public, max-age=300…`
- [ ] `GET /api/users/me` returns `Cache-Control: private, no-store`
