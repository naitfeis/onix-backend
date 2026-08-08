# Урок 4 — объекты

## Цель
Хранить связанные данные одного пользователя или товара.

```js
const user = { name: 'Max', balance: 5000 };
console.log(user.name);
user.balance = 4000;
```

Точка получает свойство. Объект с `const` можно менять внутри, но нельзя заменить весь объект.

## Самостоятельно
Создай `user` и `product`, затем передай их свойства в `sell(user.name, user.balance, product.price, product.quantity)`. Запиши возвращённый баланс обратно.
