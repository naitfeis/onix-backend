# Урок 6 — find и filter

## Цель
Понимать разницу между одним результатом и списком результатов.

`find()` возвращает первый объект или `undefined`. `filter()` возвращает новый массив, возможно `[]`.

```js
const found = products.find((p) => p.name === 'Roblox');
const expensive = products.filter((p) => p.price >= 500);
```

`find` проверяй через `if (found)`, `filter` — через `results.length > 0`.

## Самостоятельно
Найди Telegram, обработай отсутствующий Minecraft, отфильтруй товары от 300 ₽ и товары с количеством не больше 3.
