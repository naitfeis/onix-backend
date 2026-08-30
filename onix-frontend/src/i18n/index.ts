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
  'common.loading': 'Загрузка…',
  'common.retry': 'Попробовать снова',
  'common.showMore': 'Показать ещё',
  'common.cancel': 'Отмена',
  'common.close': 'Закрыть',
  'market.all': 'Все',
  'market.search': 'Товар, продавец, ONIX ID или ONIXLOT',
  'market.searchAria': 'Поиск товаров',
  'market.categories': 'Категории',
  'market.buy': 'Купить',
  'market.favoriteAdd': 'В избранное',
  'market.favoriteRemove': 'Убрать из избранного',
  'market.emptyTitle': 'Ничего не найдено',
  'market.emptyText': 'Измените запрос или фильтры. Можно разместить собственный лот.',
  'market.unavailable': 'Витрина недоступна',
  'market.reviews': 'отзывов',
  'chat.unread': 'непрочитанных сообщений',
  'chat.search': '🔍 Поиск: ONIX ID, ник',
  'chat.searchAria': 'Поиск чатов',
  'chat.emptyTitle': 'Нет диалогов',
  'chat.emptyText': 'Напишите продавцу из карточки товара.',
  'chat.chooseTitle': 'Выберите диалог',
  'chat.chooseText': 'Переписка откроется здесь.',
  'chat.messagePlaceholder': 'Введите сообщение...',
  'chat.messageAria': 'Сообщение',
  'chat.send': 'Отправить',
  'chat.newMessages': 'Новые',
  'profile.history': 'ИСТОРИЯ',
  'profile.listings': 'МОИ ТОВАРЫ',
  'profile.favorites': 'ИЗБРАННОЕ',
  'profile.reviews': 'ОТЗЫВЫ',
  'profile.analytics': 'АНАЛИТИКА',
  'profile.support': 'ПОДДЕРЖКА',
  'support.orders': 'ЗАКАЗЫ',
  'support.reports': 'ЖАЛОБЫ',
  'support.refresh': 'Обновить',
  'support.queueUnavailable': 'Очередь недоступна',
  'support.queueLoadError': 'Не удалось загрузить обращения.',
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
