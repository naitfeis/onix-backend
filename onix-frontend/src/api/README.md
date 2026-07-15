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
- Same-origin API: leave `VITE_API_URL` empty so requests hit `/api/...` (Vercel rewrite / Vite proxy). Required for `__Host-onix_rt`.
- Absolute `VITE_API_URL` remains supported for today’s cross-origin setup; Auth V2 cookies will not work on that topology.
- Do not change `vercel.json` while the existing `/api` rewrite works.

See `docs/architecture/ONIX-WEBSITE-AUTH-TESTS.md`.
