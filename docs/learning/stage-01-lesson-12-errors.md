# Этап 1. Урок 12 — Error, throw, try/catch/finally

## Цель

Научиться отличать ожидаемый отказ покупки от неправильных данных и настоящей ошибки выполнения. Ошибка не должна незаметно превращать баланс в `undefined`, `NaN` или отрицательное число.

## 1. Три разных ситуации

### Обычный успешный результат

Покупка проведена, функция возвращает новый баланс.

### Ожидаемый отказ

Данных достаточно для расчёта, но денег не хватает. Это нормальный бизнес-результат, а не авария программы. Можно вернуть объект:

```js
return {
  ok: false,
  reason: "INSUFFICIENT_FUNDS",
  balance,
};
```

### Некорректные данные

Цена `NaN`, количество дробное или объект отсутствует. Здесь можно выбросить ошибку, потому что функция не способна безопасно продолжить расчёт.

## 2. Объект Error

```js
const error = new Error("Некорректная цена");
```

У ошибки есть `name`, `message` и stack trace. `throw` выбрасывает ошибку и немедленно прерывает текущую функцию:

```js
function validatePrice(price) {
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Цена должна быть конечным числом больше нуля");
  }
}
```

Код после выполненного `throw` не запускается.

## 3. try/catch

```js
try {
  validatePrice(-500);
  console.log("Цена корректна");
} catch (error) {
  console.log(`Ошибка: ${error.message}`);
}
```

`try` содержит код, который может выбросить ошибку. `catch` выполняется только при ошибке. После обработки программа продолжает работу после конструкции.

## 4. finally

```js
try {
  // операция
} catch (error) {
  // обработка
} finally {
  console.log("Попытка завершена");
}
```

`finally` выполняется и при успехе, и при ошибке. Он полезен для освобождения ресурса или завершения индикатора загрузки. Не помещай туда списание денег: оно выполнится даже после ошибки.

## 5. Безопасная валидация твоего buy

```js
function validatePurchaseInput({ balance, price, quantity }) {
  if (!Number.isFinite(balance) || balance < 0) {
    throw new Error("Некорректный баланс");
  }

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Некорректная цена");
  }

  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("Некорректное количество");
  }
}
```

Затем расчёт:

```js
function buy({ name, balance, type, price, quantity }) {
  validatePurchaseInput({ balance, price, quantity });

  const fullPrice = price * quantity;
  const discount = fullPrice >= 5000 ? fullPrice * 0.15 : 0;
  const finalPrice = fullPrice - discount;

  if (balance < finalPrice) {
    return {
      ok: false,
      reason: "INSUFFICIENT_FUNDS",
      name,
      type,
      balance,
      finalPrice,
    };
  }

  return {
    ok: true,
    reason: null,
    name,
    type,
    balance: balance - finalPrice,
    finalPrice,
  };
}
```

Преимущество объекта результата: функция всегда возвращает одну понятную структуру, а не то число, то `undefined`, то сообщение.

## 6. Вызов с try/catch

```js
try {
  const result = buy(buyer);

  if (result.ok) {
    console.log(`Покупка успешна. Остаток: ${result.balance} ₽`);
  } else {
    console.log(`Отказ: ${result.reason}`);
  }
} catch (error) {
  console.log(`Входные данные отклонены: ${error.message}`);
}
```

## 7. Не ловить ошибку слишком рано

Плохо:

```js
try {
  // большой блок из 200 строк
} catch (error) {
  console.log("Что-то сломалось");
}
```

Так теряется место и причина. Лови ошибку на границе, где можешь осмысленно решить, что делать. Не оставляй пустой `catch`.

## 8. Не использовать try/catch вместо if

Нехватка денег ожидаема:

```js
if (balance < finalPrice) {
  return { ok: false, reason: "INSUFFICIENT_FUNDS" };
}
```

Не нужно выбрасывать исключение для каждого обычного пользовательского отказа. Исключение сообщает: входные данные или состояние не позволяют корректно выполнить операцию.

## Типичные ошибки

- После `throw` ожидать выполнение нижних строк.
- В `catch` не выводить `error.message`.
- Менять баланс до валидации.
- Возвращать `undefined` на одном из путей.
- Использовать `finally` для бизнес-операции.
- Ловить ошибку и притворяться, что операция успешна.

## Самостоятельное задание

1. Перепиши `buy`, чтобы она принимала один объект buyer.
2. Вынеси проверки в `validatePurchaseInput`.
3. Ошибочные числа должны приводить к `throw new Error(...)`.
4. Нехватка денег должна вернуть `{ ok: false }`, а не выбрасывать ошибку.
5. Успех должен вернуть `{ ok: true, balance, finalPrice }`.
6. Обработай вызов через `try/catch/finally`.
7. Докажи выводом, что исходный buyer не изменился при ошибке и отказе.

Проверь: нормальную покупку, цену 0, `NaN`, `Infinity`, quantity 0, -1, 2.5 и нехватку денег.

## Урок закрыт, если

Ты объясняешь разницу между обычным отказом и исключением, гарантируешь предсказуемый return и не меняешь данные до успешной проверки.
