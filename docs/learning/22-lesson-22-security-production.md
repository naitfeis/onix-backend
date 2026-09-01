# Урок 22 — безопасность и production

## Цель
Понимать auth ONIX и развёртывание.

Полная карта (ветки, Ed25519, cookie, ledger, что нельзя упрощать): **[урок 30](./30-onix-owner-architecture-security.md)**.

Изучи sessions, HttpOnly/Secure/SameSite cookies, JWT EdDSA vs opaque refresh, rotation + family revoke, CSRF (`X-ONIX-CSRF`), XSS, CORS, rate limit, audit log, device trust HMAC. Приватный ключ подписывает на backend, публичный проверяет, ротация по `kid` (`AUTH_ED25519_CURRENT_*` / `PREVIOUS_*`).

Прод (2026-09): Amvera Moscow `www.onixtg.shop` (SPA+API). Staging — Render. Neon — PostgreSQL. Cloudflare — только серый DNS. Старые схемы Vercel rewrite больше не канон.

## Самостоятельно
Опиши поток login → access token → refresh cookie → session → `sv`/`pv` check. Добавь тесты на отзыв сессии, отрицательный баланс и повторную оплату.
