# ONIX frontend API contract

`contracts.ts` is the single place for paths and transport types. All authenticated requests:

- bootstrap a Mini App once through `POST /api/auth/telegram-mini` with `initData`;
- bootstrap a browser through Telegram Login Widget and `POST /api/auth/telegram-login`;
- keep the returned access token in `sessionStorage` and send `Authorization: Bearer …`;
- never send a Telegram ID as proof of identity;
- expect `{ success, data }` or `{ success: false, error: { message } }`.

The backend verifies Telegram signatures, issues Bearer JWTs and derives identity and admin
permissions exclusively from the verified token.
