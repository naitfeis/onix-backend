# Урок 17 — fetch, Promise и async/await

## Цель
Понять запрос браузера к API.

`fetch` возвращает Promise; `await` ждёт его; `response.ok` проверяет HTTP-успех; `response.json()` читает JSON. Обрабатывай loading, success и error.

## Самостоятельно
Загрузи список товаров из тестового API или локального JSON, покажи loading, ошибки и карточки. Объясни, почему 404 нужно проверять через `response.ok`.
