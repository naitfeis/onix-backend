# Урок 10 — строки и числа

## Цель
Безопасно обрабатывать ввод пользователя.

`trim()` удаляет внешние пробелы, `toLowerCase()` нормализует регистр, `includes()` ищет часть строки. `Number('500')` превращает текст в число, `Number.isFinite()` проверяет конечное число, `Number.isInteger()` — целое.

```js
const search = input.trim().toLowerCase();
const price = Number(priceInput);
```

## Самостоятельно
Напиши `findBuyersByType(buyers, searchText)`, которая ищет без учёта регистра и пробелов через `filter` и `includes`. Отдельно проверь цену `'семьсот'` и количество `'2.5'`.
