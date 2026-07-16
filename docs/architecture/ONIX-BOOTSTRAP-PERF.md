# ONIX Bootstrap Performance Debug

| Field | Value |
| --- | --- |
| **Date** | 2026-07-16 |
| **Symptom** | ttfb=74ms, dom-interactive≈22s, bootstrap-settled≈34s |
| **Scope** | Frontend bootstrap only — no Auth/API/backend changes |

---

## What blocked first render

| Issue | Effect |
| --- | --- |
| Waterfall `telegram-mini? → restore → /v2/auth/me → me+products` | Extra RTT(s) before market |
| Mini App `bootstrapAuth` **before** website cookie restore | Telegram WebView with initData delayed Website path |
| `bootstrap-settled` after full `refreshAll` | Ops marker late even when market already had data |
| React StrictMode double `useEffect` | Could start bootstrap twice |
| orders/chats kicked off during critical path era | Contended bandwidth (already fire-and-forget; now clearly after settle) |

HTML TTFB is fine. **~22s dom-interactive** is mostly **JS download/parse** (Network → JS chunks) before React; then bootstrap added more seconds.

---

## Changes

1. **Website-first auth:** cookie `restoreSession` first; Mini App auth only if restore fails.  
2. **Removed blocking `/api/v2/auth/me`** before market — `GET /users/me` is the profile step.  
3. **Critical path:** `Promise.all([me, products])` only.  
4. **After marketplace-ready:** orders / chats / reviews (background).  
5. **`[bootstrap]` console summary** with per-phase ms.  
6. **StrictMode guard** (module-level once).  
7. **Early** `js-main` + navigation timing from `main.tsx`.

### Console format

```
[bootstrap]
telegram=xx ms
restore-session=xx ms
refresh=xx ms
me=xx ms
products=xx ms
orders=xx ms
chats=xx ms
bootstrap-settled=xx ms
```

---

## Targets

| Metric | Goal |
| --- | --- |
| dom-interactive | &lt;2s (needs fast JS delivery; check chunk sizes if still ~20s) |
| bootstrap-settled | &lt;5s (critical path only) |

If dom-interactive stays ~20s while `[bootstrap]` settle is &lt;5s → optimize **asset CDN / bundle**, not auth waterfall.
