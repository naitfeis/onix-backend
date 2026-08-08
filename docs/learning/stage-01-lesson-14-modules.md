# Этап 1. Урок 14 — модули и структура программы

## Цель

Разделить большую программу на небольшие файлы с одной ответственностью. Это подготовка к структуре ONIX и будущим React/NestJS-модулям.

## Ответственность файлов

```text
src/data.js       данные покупателей и товаров
src/validation.js проверка входных данных
src/pricing.js    расчёт скидки и итоговой цены
src/purchase.js   бизнес-операция покупки
src/report.js     отчёты
src/main.js       запуск сценария
```

Файл не должен знать лишнее о других слоях.

## export/import

`validation.js`:

```js
export function validatePrice(price) {
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Некорректная цена");
  }
}
```

`main.js`:

```js
import { validatePrice } from "./validation.js";

try {
  validatePrice(500);
} catch (error) {
  console.log(error.message);
}
```

Именованный export подключается в фигурных скобках. Пути пишутся относительно файла; расширение зависит от режима Node.

## default export

Для одного главного значения можно использовать `export default`, но на этом этапе предпочитай именованные exports: по импорту сразу видно имя публичной функции.

## Самостоятельное задание

Создай отдельную учебную папку, не меняя production ONIX. Раздели код на `data.js`, `validation.js`, `pricing.js`, `purchase.js`, `report.js`, `main.js`. Экспортируй минимум `validatePrice`, `validateQuantity`, `calculateFinalPrice`, `buy`. Запусти 5 сценариев и объясни, какой файл за что отвечает.

## Урок закрыт, если

Ты можешь создать модуль, экспортировать функцию, импортировать её и объяснить, почему расчёт не должен напрямую менять UI или базу данных.
