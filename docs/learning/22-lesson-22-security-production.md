# Урок 22 — безопасность и production

## Цель
Понимать auth ONIX и развёртывание.

Изучи sessions, HttpOnly/Secure/SameSite cookies, JWT, refresh rotation, CSRF, XSS, CORS, rate limit, MFA, audit log, device trust. Затем Ed25519/EdDSA и `kid`: приватный ключ подписывает на backend, публичный проверяет, ротация идёт по key id.

Инфраструктура: Vercel — frontend/rewrite, Render — Nest API, Neon — PostgreSQL, Cloudflare — DNS/edge.

## Самостоятельно
Опиши поток login → access token → refresh cookie → session → permission check. Добавь тесты на отзыв сессии, отрицательный баланс и повторную оплату.
