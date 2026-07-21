/**
 * Minimal i18n — RU primary for Russia launch.
 * Keys stay stable so EN (or more locales) can plug in later.
 */

const ru = {
  'navigation.market': 'Маркет',
  'navigation.orders': 'Мои заказы',
  'navigation.deals': 'Сделки',
  'navigation.profile': 'Профиль',
  'navigation.messages': 'Сообщения',
  'navigation.chat': 'Чат',
  'navigation.sell': 'Продать товар',
  'navigation.lot': 'Лоты',
  'navigation.main': 'Главная',
  'navigation.aria': 'Основная навигация',
  'navigation.sidebar': 'Навигация',
  'theme.light': 'Светлая тема',
  'theme.dark': 'Тёмная тема',
  'theme.enableLight': 'Включить светлую тему',
  'theme.enableDark': 'Включить тёмную тему',
  'widgets.wallet': 'Кошелёк',
  'widgets.notifications': 'Уведомления',
  'widgets.liveNotifications': 'Уведомления',
  'widgets.newLots': 'Новые лоты',
  'widgets.aria': 'Виджеты',
  'widgets.addFunds': 'Пополнить',
  'search.aria': 'Поиск',
  'balance.aria': 'Баланс',
  'sidebar.resizeLeft': 'Изменить ширину левой панели',
  'sidebar.resizeRight': 'Изменить ширину правой панели',
} as const;

export type MessageKey = keyof typeof ru;

const catalogs = { ru } as const;
export type Locale = keyof typeof catalogs;

let locale: Locale = 'ru';

export function setLocale(next: Locale): void {
  locale = next;
}

export function getLocale(): Locale {
  return locale;
}

/** Translate a key; falls back to the key string if missing. */
export function t(key: MessageKey): string {
  return catalogs[locale][key] ?? catalogs.ru[key] ?? key;
}
