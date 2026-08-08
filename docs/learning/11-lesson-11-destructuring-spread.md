# Урок 11 — деструктуризация и spread

## Цель
Удобно доставать свойства и создавать обновлённые копии.

```js
const { name: buyerName, balance } = buyer[0];
const [first, second, ...others] = buyers;
const copy = { ...buyer, status: 'VIP', balance: buyer.balance + 1000 };
```

В объекте `{}` достаются свойства, в массиве `[]` — позиции. Spread копирует значения; свойство справа перезаписывает одинаковое свойство слева.

## Самостоятельно
На своём `buyer` создай `vipMax` без изменения Max. Затем через `map` создай `updatedBuyers`: только Saveliy получает `balance: 4000` и `status: 'VERIFIED'`, остальные возвращаются без изменений. Сравни старый и новый массив.
