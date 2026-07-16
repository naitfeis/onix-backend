# ONIX Production Website — Network Audit (RU / no-VPN)

| Field | Value |
| --- | --- |
| **Date** | 2026-07-16 |
| **Scope** | Network path only (DNS, CF, Vercel rewrite, Render, cache, IPv6) |
| **Not changed** | Auth V2 · Ed25519 · Telegram Login · cookie strategy names |

---

## Symptom (RU without VPN)

| Metric | Observed |
| --- | --- |
| `GET /api/v2/auth/session` | ~**2.5s** (matches client session timeout abort) |
| `GET /api/products` | ~**12s** AbortError (client default fetch timeout) |
| Cookie | sometimes missing (`__Host-onix_rt`) |
| With VPN | auth + cookie OK, bootstrap &lt;2s |

HTML TTFB stays fast — problem is **API hop**, not SPA CDN.

---

## 1. Real route: `www.onixtg.shop/api/*`

```
Browser (RU)
  → DNS www → cname.vercel-dns.com (Vercel A 66.33.60.x / 76.76.21.x)
  → TLS to Vercel edge
  → vercel.json rewrite /api/* → https://onix-api-47tj.onrender.com/api/*
  → Render origin (Frankfurt) behind Render’s Cloudflare CDN (216.24.57.x)
  → Nest / Neon
```

### Probe (EU/CDG host, 2026-07-16)

| Check | Result |
| --- | --- |
| `www` Cloudflare orange-cloud? | **No** — `Server: Vercel`, **no `cf-ray`** on `GET /` |
| `www/api/*` still sees CF? | **Yes** — responses carry `Cf-Ray`, `X-Render-Origin-Server: Render` (Render’s CF in front of API) |
| `api.onixtg.shop` | **HTTP 200** (Error 1000 fixed); CNAME → Render → CF CDN |
| Browser should call | **`www.onixtg.shop/api/*` only** (required for `__Host-` cookie) |

**Verdict:** HTML correctly bypasses CF proxy. **API still traverses Cloudflare** because Render terminates TLS on CF CDN. “API must not go through Cloudflare proxy” is **not true today** for the Render hop — only the www DNS record is grey/Vercel-direct.

---

## 2. Vercel rewrite latency

| Target | TTFB (probe) |
| --- | --- |
| `www` HTML | ~607ms (cache HIT) |
| `www/api/health/live` | ~575ms |
| `www/api/health/network` | ~764ms |
| `www/api/products?limit=5` | ~609ms |
| `www/api/v2/auth/session` | ~529ms (401) |
| Direct `onix-api-47tj.onrender.com/.../live` | ~669ms |

**Rewrite tax (this probe):** roughly **0–150ms** vs direct Render — not the 2.5s / 12s RU failures.  
RU no-VPN delays are dominated by **path instability / throttling / hung sockets**, not steady rewrite overhead.

---

## 3. Render region

| Item | Value |
| --- | --- |
| Blueprint | `render.yaml` → `region: frankfurt` |
| Hostname (live) | `srv-…-hibernate-…` (Starter / can cool down) |
| `GET /api/health/network` | returns `hostname`, `region`, `responseTimeMs` |

Cold/hibernating Starter instances amplify first-request latency after idle.

---

## 4. `GET /api/health/network`

Enhanced probe (no secrets):

```json
{
  "status": "ok",
  "hostname": "srv-…",
  "region": "frankfurt",
  "responseTimeMs": 0.12,
  "timestamp": "…",
  "via": { "host": "…", "forwardedFor": "…", "vercelId": "…", "cfRay": "…" }
}
```

Headers: `Cache-Control: no-store`, `X-Response-Time`, `Server-Timing`.

Also set `RENDER_REGION=frankfurt` in `render.yaml` so region is not `unknown`.

---

## 5. Cache-Control

| Surface | Expected | Observed / action |
| --- | --- | --- |
| Auth (`/api/v2/auth/session`, login, refresh) | **`no-store`** | Set on controller |
| Health (`live`, `ready`, `network`) | **`no-store`** | Set on controller |
| Products (anonymous) | **`public, max-age=30, stale-while-revalidate=120`** | OK |
| Products (authenticated) | **`private, no-store`** | OK |
| Profiles / orders / chats | `private, no-store` | OK |

Note: Vercel may still attach `public, max-age=0, must-revalidate` on some rewritten responses; origin `no-store` must win for auth. Do **not** blanket-cache all `/api/*` on CF — allow short edge cache only for anonymous `GET /api/products*` if ops adds a Cache Rule.

---

## 6. IPv6 / AAAA

| Host | AAAA |
| --- | --- |
| `www.onixtg.shop` | **None** (IPv4 only via Vercel) |
| `api.onixtg.shop` | **None** |
| `onix-api-47tj.onrender.com` | **None** (CF SOA only) |

No AAAA → lower risk of broken IPv6 WebView paths. Keep it that way unless Vercel/Render adds dual-stack intentionally.

---

## Root cause map (RU no-VPN)

| Symptom | Likely cause |
| --- | --- |
| session ≈ 2.5s | Client `getAuthV2Session` timeout **2500ms** — request hung until abort (not Nest CPU) |
| products ≈ 12s AbortError | Client `DEFAULT_FETCH_TIMEOUT_MS=12000` — hung hop RU→Vercel→Render/CF |
| cookie sometimes missing | `__Host-onix_rt` only on **exact** `https://www.onixtg.shop` (Secure, no Domain). Wrong host / non-HTTPS / cleared WebView storage / blocked third-party-like behavior → no cookie → session 401 (fast after probe fix) |
| VPN OK | Clean path to Vercel/Render; no RU ISP throttle |

---

## Ops recommendations (to hit goals)

**Goals:** session &lt;500ms · products &lt;1s · bootstrap &lt;3s (RU no VPN)

1. **Shorten API path for RU** (pick one):
   - Prefer **direct same-origin** but move API closer / always-on Render (no hibernate).
   - Or Cache Rule: cache **anonymous** `GET /api/products*` at edge (short TTL); never cache `/api/v2/auth/*`.
2. **Confirm www stays DNS-only → Vercel** (already true in this probe).
3. **Do not send browsers to `api.onixtg.shop`** for SPA — breaks `__Host-` cookie even when DNS works.
4. **Render:** keep Frankfurt; set always-on / ping `/api/health/live` if Starter sleeps.
5. **Measure from RU IP:** open `https://www.onixtg.shop/api/health/network` and compare `via.cfRay` / `responseTimeMs` with/without VPN.

---

## Code touchpoints (this pass)

| File | Change |
| --- | --- |
| `operations.module.ts` | `/api/health/network` → hostname, region, responseTimeMs, via hints; live/ready `no-store` |
| `auth-v2.controller.ts` | session/login/refresh `Cache-Control: no-store` |
| `render.yaml` | `RENDER_REGION=frankfurt` |

Auth V2 crypto, Ed25519, Telegram Login, cookie names/flags — **unchanged**.
