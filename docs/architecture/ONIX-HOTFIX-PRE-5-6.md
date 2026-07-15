# HOTFIX pre-5.6 — UX + Follow

## Fixes

1. **Product form** — after category select, subcategories show immediately as chips (no second dropdown / intermediate step).
2. **Market** — removed decorative `ВИТРИНА ONIX MARKETPLACE` header; catalog starts at search/filters.
3. **Follow** — Prisma `Follow` + API already existed; wired `seller.followed` + `followersCount` in product DTO, follow/unfollow returns counts, FE button toggles Подписаться/Отписаться and updates count (no mocks).
4. **Ref Tools** — removed `marketTick` manual state bump; refresh/retry call catalog reload directly; modal seller follow state syncs from catalog store.

Auth / Telegram Login / design system unchanged.
