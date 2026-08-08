# Урок 7 — map

## Цель
Создавать новый массив, преобразуя каждый элемент.

```js
const names = products.map((product) => product.name);
const totals = products.map((product) => product.price * product.quantity);
```

`map` сохраняет длину массива. Для простого вывода используй `for...of`, а не map без return.

## Самостоятельно
Создай массив названий, массив цен, массив стоимостей позиций и массив `{name, totalPrice}`. Проверь, что исходный массив не изменился.
