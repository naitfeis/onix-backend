# ONIX frontend API / auth notes

`contracts.ts` is the single place for paths and transport types.

## Current production (legacy Website + Mini App)

- Mini App: `POST /api/auth/telegram-mini` with `initData`; JWT in `sessionStorage`.
- Website: Telegram Login Widget → `POST /api/auth/telegram-login`; JWT in `sessionStorage`.
- Authenticated requests send `Authorization: Bearer …` and expect `{ success, data }` envelopes.
- Never send a Telegram ID as proof of identity.

## Website Auth V2 cutover (frontend only; backend frozen)

- Abstraction: `WebsiteAuthProvider` (`legacy` | `auth_v2`) under `src/auth/`.
- Temporary switch: `VITE_WEBSITE_AUTH_MODE=legacy|auth_v2` (default `legacy`). Remove after soak.
- Same-origin API: **leave `VITE_API_URL` empty** (required). Browser calls `/api/...`; Vercel rewrites to Render.
- Absolute Render URLs are stripped by `resolveApiBase` so the Network panel never shows onrender.com.
- Local proxy target: `VITE_API_PROXY_TARGET` (default `http://localhost:3000`).
- Do not change `vercel.json` while the existing `/api` rewrite works.

See `docs/architecture/ONIX-WEBSITE-AUTH-TESTS.md`.
