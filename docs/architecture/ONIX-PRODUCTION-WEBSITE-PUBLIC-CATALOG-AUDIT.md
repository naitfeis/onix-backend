# ONIX Production — Website public catalog + non-blocking session

| Field | Value |
| --- | --- |
| **Date** | 2026-07-16 |
| **Scope** | Website bootstrap architecture (public catalog, session parallel) |
| **Not changed** | Ed25519, Auth V2 crypto/cookie names, API DTO contracts, UI visual design |

---

## 1. Observed production symptom

| Path | Timing |
| --- | --- |
| VPN | `auth-session≈578ms`, `products≈263ms`, `bootstrap≈580ms` |
| RU no VPN | `auth-session≈3435ms`, `products≈12439ms AbortError`, `bootstrap≈18561ms` |
| HTML | `ttfb≈55ms` → **not** a Cloudflare HTML problem |

`products≈12439ms` + `AbortError` matches the frontend client timeout (`DEFAULT_FETCH_TIMEOUT_MS = 12_000` in `fetchResilience.ts`): the request **did not complete** before the browser aborted. That is a hung/slow hop on the API path (RU → CF → Vercel rewrite → Render Frankfurt → Neon), not an HTML CDN miss.

---

## 2. Root causes (code + network)

| Layer | Finding | Effect |
| --- | --- | --- |
| **Backend auth guard** | Historically `GET /products` was **not** `@Public()` → global `AuthGuard` required Bearer → guests got **401** | Catalog blocked without login |
| **Frontend Market** | Catalog effect required `core.profile` | Guest saw “login via Telegram” instead of listings |
| **Frontend bootstrap** | Session / refresh could serialize ahead of catalog; guest could await hung products | `bootstrap` tens of seconds |
| **Network (RU)** | Long origin hop + CF RU throttling; CF **API bypass** so edge does not cache `/api/*` | Same public GET can hang ~12s until client abort |
| **Not** | Cookie strategy / Ed25519 / Auth V2 contracts | Unchanged by design |

---

## 3. Target architecture (implemented)

```
render shell
    ↓
load public GET /api/products     ←── parallel ──→   GET /api/v2/auth/session (cookie)
    ↓                                              ↓
marketplace-ready (when products settle)     401 → guest (no Telegram SDK)
                                             200 → refresh access → profile-load → orders/chats
```

- **Telegram SDK** is not on the website critical path (only first login / cookie mint).
- **Guest** browses catalog without auth; soft `AuthNotice` banner for login CTA.
- **User** restores via `__Host-onix_rt` HttpOnly cookie only.

---

## 4. Code changes

### Backend (`safe-deal-platform/src/marketplace.module.ts`)

- `@Public()` on `GET /products` and `GET /products/:id` — **401 forbidden for catalog**.
- Soft `optionalViewer()` — invalid/missing Bearer → anonymous catalog (never throws).
- Guest Prisma select: no favorites join; `followers take: 0`.
- `Cache-Control`: `public, max-age=30, stale-while-revalidate=120` for anonymous; `private, no-store` when personalized.

### Frontend

| File | Change |
| --- | --- |
| `useOnixCore.ts` | Website: `products-public` + `session-check` parallel; guest settle without awaiting hung products; `profile-load` only after session OK |
| `Market.tsx` | Catalog renders without requiring profile |
| `bootstrapTiming.ts` | Phases: `products-public`, `session-check`, `profile-load` |

Mini App path unchanged: Telegram first, then marketplace.

---

## 5. Timing console labels

Expected `[bootstrap]` lines after deploy:

```
telegram=0 ms
products-public=… ms
session-check=… ms
cookie-check=…
refresh=…          (only if session 200)
profile-load=…     (only if authenticated)
marketplace=0 ms
bootstrap=… ms
```

Legacy names (`auth-session`, `products`, `me`) may still appear on Mini App or stale bundles.

---

## 6. Why RU still can hit ~12s on products

Even with a public endpoint:

1. Client aborts at **12s** if origin never answers (VPN healthy vs RU path).
2. Cloudflare rule **Bypass cache for `/api/`** → anonymous `Cache-Control: public` helps the **browser**, not the CF edge, until ops allow caching `GET /api/products` without `Authorization`.
3. HTML TTFB stays fast because SPA is edge-cached; API rewrite to Render is a separate hop.

**Ops follow-up (recommended):** Cache Rule exception — `GET /api/products*` with no `Authorization` → Cache Eligible, short Edge TTL (30–60s), respect origin `Cache-Control`. Do **not** cache authenticated responses.

---

## 7. Acceptance checklist

| Check | Pass criteria |
| --- | --- |
| Guest catalog | `GET /api/products` → **200** without cookie/Bearer |
| No catalog 401 | Missing/invalid token → anonymous list, not 401 |
| First paint | Shell + market skeleton without waiting for session |
| Guest settle | After `session-check` 401; does not wait for products timeout |
| Authenticated | Cookie session → `profile-load` + secondary collections |
| Telegram | Not loaded for website restore |
| Timing | `products-public` / `session-check` / `profile-load` in console |

---

## 8. Deploy order

1. **API (Render)** — public `@Public` products (required before FE assumes guest catalog).
2. **Frontend (Vercel)** — non-blocking bootstrap + Market guest browse.
3. Re-measure RU no-VPN console `[bootstrap]` + Network tab for `/api/products`.
