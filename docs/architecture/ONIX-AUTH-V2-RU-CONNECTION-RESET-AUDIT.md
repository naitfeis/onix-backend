# ONIX Auth V2 — Production Network Audit (RU / ERR_CONNECTION_RESET)

| Field | Value |
| --- | --- |
| **Date** | 2026-07-16 |
| **Symptom** | RU no-VPN: `GET /api/products` 200 ~50ms; `GET /api/v2/auth/session` → `ERR_CONNECTION_RESET` / client timeout 2.5–32s; Render often **never sees** the request. VPN: session + cookie + refresh OK |
| **Not changed** | Auth V2 · Ed25519 · cookie strategy · API contract · frontend flow |

---

## 1. Full request path

```
Browser (RU)
  → DNS www.onixtg.shop → Vercel (no CF orange-cloud on www)
  → vercel.json rewrite /api/* → https://onix-api-47tj.onrender.com/api/*
  → Render origin (Frankfurt) behind Render’s Cloudflare CDN
  → Nest
```

| Hop | products | v2/auth/session |
| --- | --- | --- |
| Browser → Vercel | same origin | same origin |
| Vercel rewrite | same rule `/api/:path*` | same rule |
| Render CF CDN | yes (`Cf-Ray` on API responses) | yes |
| Nest | `MarketplaceController` | `AuthV2Controller.session` |

**Same rewrite.** Difference is **URL path** (`/products` vs `/v2/auth/session`) and whether the request completes to origin.

---

## 2–4. Diagnostics added (deploy required)

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health/route-debug` | `requestId`, `cfRay`, `cfConnectingIp`, `forwarded`, `host`, `origin`, `userAgent`, `cookieSize`, `region`, `timestamp` |
| `GET /api/session-probe` | **cookiePresent only** — no DB / refresh / lookup |
| Middleware `authSessionPathMiddleware` | Logs **`AUTH_SESSION_REQUEST_START`** (requestId, host, origin, cookie length, UA) **before** AuthGuard/controller |

If RU still resets on `/api/v2/auth/session` but:

| Result | Means |
| --- | --- |
| `session-probe` OK, `session` fail | path `/v2/auth/…` or DB path |
| both fail, `products` OK | path filter / DPI / WAF on `auth` |
| no `AUTH_SESSION_REQUEST_START` in Render | reset **before Nest** (A/B) |
| START log present, no END | accepted then aborted mid-handler (C/E) |

`Server-Timing` phases: `edge`, `middleware`, `controller`, `db` (+ cookie/hash detail on session).

---

## 5. Cloudflare / security (ops checklist — dashboard)

Cannot read your CF zone from code. Check on **Render’s CF** (API CDN) and any rules on `onixtg.shop`:

| Setting | Why |
| --- | --- |
| WAF custom rules matching `auth`, `session`, `login` | Often reset/challenge auth URLs |
| Bot Fight Mode / Super Bot Fight | WebView + Cookie → challenge → reset |
| Rate limiting on `/api/v2/*` | Burst bootstrap looks like bots |
| Security Level = High/I’m Under Attack | Breaks API XHR |
| Browser Integrity Check | Same |
| API path filtering / Skip for `/api/products` only | Explains products OK, auth not |

**www is Vercel-direct** (no `cf-ray` on HTML). API still sees CF via Render CDN.

---

## 6. Cookie size

| Item | Size |
| --- | --- |
| `__Host-onix_rt` value | ~43 chars (32-byte base64url) |
| Full Cookie name=value | ~**60–80 bytes** — **not large** |
| Same Cookie header | sent on **all** same-origin `/api/*` including products |

Cookie size alone does **not** explain products 50ms vs session reset. Path discrimination is more likely than header size.

EU probe note: attaching a fake `__Host-onix_rt` cookie correlated with ~5s wall time on several paths while Nest `X-Response-Time` stayed &lt;5ms → edge/proxy delay, not Nest DB.

---

## 7. `session-probe` vs `session`

| | `session-probe` | `v2/auth/session` |
| --- | --- | --- |
| Cookie read | yes | yes |
| DB | **no** | yes (when cookie present) |
| Path contains `auth` | **no** | **yes** |

After deploy, RU matrix:

```
/api/products
/api/session-probe
/api/debug/session
/api/health/route-debug
/api/v2/auth/session
```

---

## 8. Cause verdict (pre–RU re-measure)

| Code | Hypothesis | Evidence |
| --- | --- | --- |
| **A) Россия/DPI** | **Primary suspect** | VPN fixes; products OK; session `ERR_CONNECTION_RESET`; Render often no log → TCP reset **before origin** |
| **B) Cloudflare/Vercel** | **Strong secondary** | API via Render CF; WAF/Bot rules often target `*auth*`; Vercel rewrite identical for both paths |
| **C) Render** | Unlikely as sole cause | When request arrives, Nest answers ~1–5ms; cold start affects all paths |
| **D) cookie/header** | Unlikely sole cause | Cookie tiny; same Cookie on products |
| **E) backend** | Ruled out for missing-cookie / no-log cases | Handler ~1ms; no START log ⇒ never entered Nest |

**Working conclusion:** **A + B** (RU path / DPI or CF security treating `/api/v2/auth/*` differently). **Not E** when Render has no request. Confirm with post-deploy RU curls below — no architecture change until confirmed.

---

## RU measurement script (after deploy)

```bash
# Without VPN (RU) and with VPN — same commands:

curl -v -o NUL -w "ttfb=%{time_starttransfer} total=%{time_total} code=%{http_code}\n" \
  "https://www.onixtg.shop/api/products?limit=1"

curl -v -b "cookies.txt" -c "cookies.txt" -w "ttfb=%{time_starttransfer} total=%{time_total} code=%{http_code}\n" \
  "https://www.onixtg.shop/api/session-probe"

curl -v -b "cookies.txt" -w "ttfb=%{time_starttransfer} total=%{time_total} code=%{http_code}\n" \
  "https://www.onixtg.shop/api/v2/auth/session"

curl -v -b "cookies.txt" -w "ttfb=%{time_starttransfer} total=%{time_total} code=%{http_code}\n" \
  "https://www.onixtg.shop/api/health/route-debug"
```

Browser: Network → compare `products` vs `session` vs `session-probe` (status, time, Cookie length).  
Render logs: search `AUTH_SESSION_REQUEST_START`.

| Pattern | Cause |
| --- | --- |
| products OK, session-probe OK, session RESET, no START | **A/B path filter on `/v2/auth`** |
| products OK, both session* RESET, no START | **A/B on cookie+path or any `/session`** |
| START present, slow/401/200 | **C/E** — then inspect Server-Timing `db` |

---

## Code touchpoints

| File | Change |
| --- | --- |
| `auth-session-path.middleware.ts` | early `AUTH_SESSION_REQUEST_START` |
| `session-probe.controller.ts` | `GET /api/session-probe` |
| `operations.module.ts` | `GET /api/health/route-debug` |
| `main.ts` | register middleware after request-id |
| `auth-v2.controller.ts` | Server-Timing `edge/middleware/controller/db` |

No Auth V2 crypto, Ed25519, cookie flags, or FE bootstrap changes.
