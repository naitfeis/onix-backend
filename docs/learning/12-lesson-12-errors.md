# Урок 12 — throw и try/catch

## Цель
Отличать обычный результат от ошибки и безопасно её обрабатывать.

```js
function validatePrice(price) {
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('Некорректная цена');
  }
  return price;
}

try {
  validatePrice(-1);
} catch (error) {
  console.log(error.message);
}
```

`throw` прерывает текущую функцию; `catch` получает ошибку; `finally` выполняется всегда. Не скрывай ошибки без сообщения и не изменяй баланс при ошибке.

## Самостоятельно
Перепиши валидацию `buy`: ошибка цены и количества должна попадать в `catch`, баланс при этом не меняется. Проверь успех, нехватку денег, цену 0, quantity -1 и `NaN`.
