# ONIX Production Network Debug — Russia Accessibility

| Field | Value |
| --- | --- |
| **Date** | 2026-07-16 |
| **Goal** | `https://www.onixtg.shop` stable in Russia **without VPN** (ordinary web, not Mini App) |
| **Constraint** | No Auth V2 / API contract / architecture / design changes |

---

## 1. Where the connection breaks

| Layer | Verdict | Evidence |
| --- | --- | --- |
| **Frontend JS** | OK | SPA loads; user sees shell + «Витрина недоступна» |
| **DNS www** | OK | Resolves to Cloudflare Anycast (A + **AAAA**) |
| **Cloudflare (www, proxied)** | **Primary RU failure point** | Orange cloud + RU ISP throttle of CF ([CF blog Jun 2025](https://blog.cloudflare.com/russian-internet-users-are-unable-to-access-the-open-internet/)) → `ERR_CONNECTION_RESET`, hung `/api/products`, Pending `/api/users/me` |
| **Vercel rewrite** | Extra hop (not root RU cause) | EU: www `/api/health` ~292ms; adds latency vs direct Render |
| **Render** | OK when reachable | Direct `onix-api-47tj.onrender.com` ~379ms, HTTP 200 |
| **DNS `api.`** | Broken for browser | **Error 1000** (CNAME to Render/CF without Render custom hostname) |
| **IPv6** | Risk for RU mobile | `www` has AAAA → CF IPv6; some RU operators mishandle CF v6 |
| **CORS** | Not the RU failure | Preflight 204, `Allow-Origin: https://www.onixtg.shop` |
| **Auth / Prisma** | Not root cause | Failures are transport reset before JSON |

**Symptom chain:** Frontend OK → API XHR via same-origin `/api` traverses **CF** → resets in RU → products error / me Pending.

---

## 2. Real API endpoint (Variant A vs B)

| | Path | Used by browser? |
| --- | --- | --- |
| **A (actual)** | `www.onixtg.shop/api/*` → Cloudflare → **Vercel rewrite** → Render | **YES** |
| **B** | `api.onixtg.shop` → Render | **NO** (and currently 403 Error 1000) |

Code proof:

- `VITE_API_URL` empty → `resolveApiBase()` → `''` → relative `/api/...`
- Absolute URLs stripped (Auth V2 `__Host-` cookies require same-origin)

**Do not switch browser to Variant B** without Auth V2 cookie redesign (forbidden in this task).

### Ideal vs allowed routes

| Desired (ops) | Allowed without Auth change |
| --- | --- |
| Browser → CF → Render (API) | Only if `/api` stays on **www** host (e.g. CF Worker proxy `/api` → Render) — not implemented |
| Browser → Vercel → Render | Works if **www is DNS-only (grey)** — skips CF throttle |

**Recommended route to leave for RU stability:**

```
Browser → Vercel (www, DNS-only) → /api rewrite → Render
         ↘ static assets from Vercel
```

Optional later (same-origin preserved): Cloudflare Worker on www proxies `/api/*` → Render (then Browser → CF → Render for API only).

---

## 3. Probe numbers (EU, 2026-07-16)

| Target | DNS | TLS | TTFB | HTTP |
| --- | --- | --- | --- | --- |
| A `www` HTML | 119ms | 233ms | **344ms** | 200 |
| A `www/api/health/live` | 26ms | 136ms | **292ms** | 200 |
| B `api.onixtg…/live` | 179ms | 305ms | **685ms** | **403** |
| C Render direct | 125ms | 218ms | **379ms** | 200 |

CORS OPTIONS via www: **204**, origins OK.

---

## 4. Changes made (this pass)

| Change | Purpose |
| --- | --- |
| `GET /api/health/network` | Temporary probe: `status`, `region`, `timestamp`, `hostname`, `ip` + `Cache-Control: no-store` |
| CORS default includes `https://www.onixtg.shop`, `https://onixtg.shop` | Safe fallback if Render env missing (no wildcard) |
| Server-Timing / X-Response-Time | Already via `requestTimingMiddleware` |
| Docs | This file |

**Not changed:** Auth V2, API DTOs, Vercel rewrite destination, business logic, design.

---

## 5. Ops checklist (must do outside git)

### Cloudflare (www)

- SSL Full (Strict if certs OK)
- HTTP/2, HTTP/3, Brotli, 0-RTT, Early Hints — On
- Rocket Loader — **Off**
- Speed Brain — **Off**
- Cache: `/api/*` Bypass; `/assets/*` Cache Everything / 1y
- **IPv6 Compatibility:** test **Off** if RU mobile still resets
- **DNS experiment:** set `www` + apex to **DNS only** → retest RU Chrome without VPN

### Render

- Region Frankfurt
- Custom Domain: add **`api.onixtg.shop`** (fixes Error 1000 for ops/alias; browser still uses www `/api`)
- Always-on / health ping if cold start hurts
- Confirm `CORS_ORIGINS=http://localhost:5173,https://www.onixtg.shop,https://onixtg.shop`

### Verify from Russia

1. `https://www.onixtg.shop/`
2. `https://www.onixtg.shop/api/health/live`
3. `https://www.onixtg.shop/api/health/network` — note `region`, `ip`
4. Logged-in: `/api/products`, `/api/users/me`
5. Chrome + mobile data; Telegram WebView secondary

---

## 6. Final answers

### Where it breaks

**Cloudflare proxied edge on the path to `/api` for RU clients** (connection reset / hang). Not Nest CORS, not missing compression, not Prisma first.

### Route to keep

```
Browser → [prefer: DNS-only] Vercel www → rewrite /api → Render Frankfurt
```

Keep same-origin `/api` on `www.onixtg.shop`. Do not point SPA at `api.onixtg.shop` until Auth strategy allows it.

### Goal

RU without VPN: grey-cloud (or Worker) removes CF throttle; code already fails fast on reset and loads market without waiting on all collections.
