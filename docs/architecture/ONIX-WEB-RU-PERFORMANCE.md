# ONIX Web Performance — Russia Browser First

| Field | Value |
| --- | --- |
| **Date** | 2026-07-16 |
| **Priority** | Ordinary web: `https://www.onixtg.shop` in Russia **without VPN** |
| **Secondary** | Telegram WebView (not the main goal of this pass) |
| **Architecture** | Unchanged: same-origin `/api` → Vercel rewrite → Render |

---

## Web Performance

### Measured path (EU probe; RU must confirm in Chrome)

```
Browser (RU)
  → Cloudflare (orange www)
  → Vercel (arn1)
  → HTML/JS assets
  → /api/* rewrite
  → Render (Frankfurt)
  → Neon
```

| Step | Probe | Result |
| --- | --- | --- |
| HTML `www.onixtg.shop/` | TTFB | **263–332ms** (Vercel HIT / CF DYNAMIC) |
| TLS www | — | ~90–210ms |
| `/api/health/live` via www | TTFB | **313–354ms** |
| `/api/health/ready` via www | TTFB | **385ms** |
| Render direct live | TTFB | **373ms** |
| `api.onixtg.shop` live | — | **403 Error 1000** (unusable) |

### First paint strategy (code)

| Before | After (this pass) |
| --- | --- |
| Await profile + products + **orders + chats** before bootstrap settle | Await only **profile + products**; orders/chats fire-and-forget |
| Auth `/me` used raw `fetch` | Auth `/me` uses `resilientFetch` |
| Fetch timeout 12s × 2 retries | **8s × 1 retry** — fail instead of endless Pending |
| Secondary tabs start as `loading` | Start `idle` until bootstrap touches them |

Shell (topbar + market chrome) renders immediately; market content waits on auth+products only — **not** on orders/chats.

### Targets vs status

| Goal | Status |
| --- | --- |
| FCP &lt; 1.5s (RU Chrome) | Needs RU measurement after deploy + CF decision below |
| Warm API &lt; 300ms | EU ~310–385ms; RU depends on CF path |
| Home &lt; 2s | Depends on CF reachability in RU |
| No endless Pending | Timeout/retry capped |

### Critical RU finding (ops)

[Cloudflare: Russian users throttled on CF-protected sites](https://blog.cloudflare.com/russian-internet-users-are-unable-to-access-the-open-internet/) (since Jun 2025).  
Orange-cloud `www` is often the **root cause** of `ERR_CONNECTION_RESET` / hangs **without VPN**.

**Recommended ops experiment (security trade-off):**

1. Set `www` + apex to **DNS only (grey)** → traffic goes **Browser → Vercel** (skip CF proxy).  
2. Keep WAF off for that test window; measure RU Chrome FCP / resets.  
3. If RU becomes stable: keep grey **or** put a RU-friendly edge in front later.  
4. Do **not** point browser API at `api.onixtg.shop` until Render custom domain fixes Error 1000 — and even then, **same-origin `/api` stays preferred** for `__Host-` cookies.

---

## Network

### Cloudflare (www)

| Setting | Required |
| --- | --- |
| HTTP/3, HTTP/2, 0-RTT, Early Hints, Brotli | On |
| Rocket Loader | **Off** |
| Cache `/assets/*` | 1 year |
| HTML | `max-age=0, must-revalidate` (already) |
| `/api/*` | Bypass cache |
| Analytics beacon | Optional off (ad-block noise only) |

**DNS**

| Host | Proxy | Verdict |
| --- | --- | --- |
| `www` / apex → Vercel | Proxied today | Works EU; **risk for RU** |
| `api` → Render | DNS only | Still **Error 1000** until Render custom domain |

### Vercel

| Item | Result |
| --- | --- |
| Rewrite `/api/*` → Render | Correct; keep |
| Static `/assets` Cache-Control | 1y immutable |
| `index.html` Cache-Control | Explicit `max-age=0` |
| Extra hop | Adds ~latency vs direct Render; required for same-origin cookies |

### API routing decision

| Option | RU / cookies | Choice |
| --- | --- | --- |
| `www.onixtg.shop/api/*` | Same-origin `__Host-` cookies; works today | **Keep** |
| `api.onixtg.shop` | Error 1000; breaks Auth V2 cookies if absolute | **Do not use in browser** |

---

## Backend

### compression (Render)

| | |
| --- | --- |
| Cause | `@types/compression` was destinies → omitted when `NODE_ENV=production` `npm ci` |
| Fix | `@types/compression` in **dependencies**; `npm ci --include=dev` in `render.yaml` |
| Local vs Render | Local had types; Render production install did not |

### Prisma / cold start

| Item | Notes |
| --- | --- |
| Pool | Single pool, keepAlive, timeouts |
| Warm health | ~300–400ms EU |
| Cold (Starter sleep) | Extra hundreds of ms–seconds — consider always-on / ping |

---

## Telegram (secondary only)

Not the focus. Same web stack; WebView inherits CF/RU issues. Optimize after RU Chrome is stable.

---

## Verification

- [x] compression + types in dependencies  
- [x] `render.yaml` `npm ci --include=dev`  
- [x] Web cold start: profile+products first  
- [x] Shorter fetch timeout / single retry  
- [ ] Deploy frontend + API  
- [ ] RU Chrome without VPN: FCP / TTFB / no reset  
- [ ] Optional: grey-cloud www A/B test  

---

## Summary

1. **Web first** — market waits only on auth + products.  
2. **API route** — stay on `www…/api` (do not switch to broken `api.`).  
3. **compression** — fixed for Render.  
4. **RU without VPN** — likely needs **DNS-only www** (or non-CF edge); code alone cannot fix ISP↔CF throttle.  
5. Telegram — later.
