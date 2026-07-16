# ONIX Frontend Bundle Audit

| Field | Value |
| --- | --- |
| **Date** | 2026-07-16 |
| **Goal** | Initial JS execution &lt; 2s |
| **Symptom** | ~16–22s until interactive (often misread as “JS execution”) |

---

## Root cause

| Factor | Role |
| --- | --- |
| **Network download** of JS on RU path | Dominant for ~16–22s `dom-interactive` when TTFB is fine |
| **Monolithic `App.tsx`** (~1.2k LOC) | All tabs + auth + modals in one parse/eval unit |
| **Eager WebGL `OnixBackground`** | Shader compile + rAF on critical path |
| **Telegram auth UI** | Pulled even when session cookie already valid |
| Charts / Crypto npm libs | **Not present** in dependencies (N/A) |

Measured build **before** split:

| Chunk | Size (raw) | gzip |
| --- | ---: | ---: |
| `framework` (React) | ~142 KB | ~45 KB |
| `index` (entire app) | ~82 KB | ~26 KB |
| **Total initial** | **~224 KB** | **~71 KB** |

There was **no** Telegram / Market / Chat / Profile chunk — everything evaluated with the main entry.

---

## After lazy split

| Chunk | Size (raw) | When loaded |
| --- | ---: | --- |
| `framework` | ~142 KB | Initial (modulepreload) |
| `index` (shell) | ~17 KB | Initial |
| `shared` | ~25 KB | With first screen |
| `Market` | ~7 KB | Default tab (prefetch) |
| `Deals` | ~6 KB | Tab / warm |
| `Chats` | ~4 KB | Tab / warm |
| `Profile` | ~8 KB | Tab / warm |
| `ProductForm` | ~3 KB | Tab / warm |
| `Admin` | ~2 KB | Profile → Admin only |
| `AuthGate` | ~12 KB | Guest / ban only |
| `OnixBackground` | ~3 KB | After idle (deferred) |
| Telegram SDK (`@twa-dev/sdk`) | **0** (not imported) | Widget = CDN script on login only |
| Charts | **N/A** | No chart library |
| Crypto | **N/A** | Web Crypto API only |

**Initial critical JS** ≈ `framework` + `index` ≈ **159 KB** (was 224 KB), then Market+shared stream in parallel.

Ops console after load:

```
[bundle]
framework: …kb download=…ms
shell: …kb download=…ms
marketplace: …kb download=…ms
main-eval=… ms
dom-interactive=… ms
```

Parse vs execute: browsers do not expose a clean “parse-only” counter; use `main-eval` (entry module evaluation) + Resource Timing `downloadMs`. If `downloadMs` ≫ `main-eval`, the 16s problem is **CDN/network**, not React CPU.

---

## Changes (UI unchanged)

1. Extract screens → `src/screens/*` + `React.lazy` / `Suspense` (same Skeleton fallback as market loading).
2. Lazy `AuthGate` (Telegram login UI).
3. Lazy `Admin` inside Profile.
4. Defer WebGL background via `requestIdleCallback`.
5. Prefetch Market immediately; warm other tabs after 1.5s.
6. Vite: named chunks, modulePreload = framework only.
7. `perf/bundleAudit.ts` + `[bundle]` summary from `main.tsx`.

---

## Targets

| Metric | Goal |
| --- | --- |
| Initial JS eval (`main-eval`) | &lt; 2s on mid-range mobile |
| `dom-interactive` | &lt; 2s when assets are warm/CDN-fast |
| First screen | Shell + Market chunk; no Chat/Profile/Admin/WebGL on critical path |
