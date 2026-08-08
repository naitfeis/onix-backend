# Урок 21 — PostgreSQL, Prisma и миграции

## Цель
Понимать таблицы ONIX и безопасные изменения схемы.

Изучи primary/foreign keys, indexes, JOIN, constraints, transactions; в Prisma — schema, relations, queries, migrations. Миграция — версия изменения структуры БД; в production её применяют через `prisma migrate deploy`.

## Самостоятельно
Нарисуй модели User, Product, Order и Ledger, связи между ними и миграцию добавления статуса заказа. Объясни, почему денежные операции требуют транзакции.
