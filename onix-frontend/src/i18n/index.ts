/**
 * Minimal i18n — RU / EN. Browser language picks the default; settings can override.
 */

import { CATEGORY_LABELS } from '../api/contracts';

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
  'theme.glass': 'Стекло',
  'theme.enableGlass': 'Включить прозрачность как Vision Pro',
  'theme.disableGlass': 'Выключить прозрачность',
  'settings.title': 'Настройки',
  'settings.open': 'Открыть настройки',
  'settings.language': 'Язык',
  'settings.languageRu': 'Русский',
  'settings.languageEn': 'English',
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
  'market.other': 'Другое',
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
  'market.backAll': 'Назад ко всем лотам',
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
  'profile.admin': 'АДМИН',
  'profile.support': 'ПОДДЕРЖКА',
  'support.orders': 'ЗАКАЗЫ',
  'support.reports': 'ЖАЛОБЫ',
  'support.refresh': 'Обновить',
  'support.queueUnavailable': 'Очередь недоступна',
  'support.queueLoadError': 'Не удалось загрузить обращения.',
} as const;

const en: { [K in keyof typeof ru]: string } = {
  'navigation.market': 'Market',
  'navigation.orders': 'My orders',
  'navigation.deals': 'Deals',
  'navigation.profile': 'Profile',
  'navigation.messages': 'Messages',
  'navigation.chat': 'Chat',
  'navigation.sell': 'Sell',
  'navigation.lot': 'Listings',
  'navigation.main': 'Home',
  'navigation.aria': 'Main navigation',
  'navigation.sidebar': 'Navigation',
  'theme.light': 'Light theme',
  'theme.dark': 'Dark theme',
  'theme.enableLight': 'Switch to light theme',
  'theme.enableDark': 'Switch to dark theme',
  'theme.glass': 'Glass',
  'theme.enableGlass': 'Enable Vision Pro transparency',
  'theme.disableGlass': 'Disable transparency',
  'settings.title': 'Settings',
  'settings.open': 'Open settings',
  'settings.language': 'Language',
  'settings.languageRu': 'Русский',
  'settings.languageEn': 'English',
  'widgets.wallet': 'Wallet',
  'widgets.notifications': 'Notifications',
  'widgets.liveNotifications': 'Notifications',
  'widgets.newLots': 'New listings',
  'widgets.aria': 'Widgets',
  'widgets.addFunds': 'Top up',
  'search.aria': 'Search',
  'balance.aria': 'Balance',
  'sidebar.resizeLeft': 'Resize left sidebar',
  'sidebar.resizeRight': 'Resize right sidebar',
  'common.loading': 'Loading…',
  'common.retry': 'Try again',
  'common.showMore': 'Show more',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'market.all': 'All',
  'market.other': 'Other',
  'market.search': 'Item, seller, ONIX ID or ONIXLOT',
  'market.searchAria': 'Search listings',
  'market.categories': 'Categories',
  'market.buy': 'Buy',
  'market.favoriteAdd': 'Add to favorites',
  'market.favoriteRemove': 'Remove from favorites',
  'market.emptyTitle': 'Nothing found',
  'market.emptyText': 'Change the query or filters. You can also post your own listing.',
  'market.unavailable': 'Market unavailable',
  'market.reviews': 'reviews',
  'market.backAll': 'Back to all listings',
  'chat.unread': 'unread messages',
  'chat.search': '🔍 Search: ONIX ID, nick',
  'chat.searchAria': 'Search chats',
  'chat.emptyTitle': 'No chats',
  'chat.emptyText': 'Message a seller from a listing card.',
  'chat.chooseTitle': 'Choose a chat',
  'chat.chooseText': 'The conversation will open here.',
  'chat.messagePlaceholder': 'Type a message...',
  'chat.messageAria': 'Message',
  'chat.send': 'Send',
  'chat.newMessages': 'New',
  'profile.history': 'HISTORY',
  'profile.listings': 'MY LISTINGS',
  'profile.favorites': 'FAVORITES',
  'profile.reviews': 'REVIEWS',
  'profile.analytics': 'ANALYTICS',
  'profile.admin': 'ADMIN',
  'profile.support': 'SUPPORT',
  'support.orders': 'ORDERS',
  'support.reports': 'REPORTS',
  'support.refresh': 'Refresh',
  'support.queueUnavailable': 'Queue unavailable',
  'support.queueLoadError': 'Could not load tickets.',
};

export type MessageKey = keyof typeof ru;
export type Locale = 'ru' | 'en';

export const MARKET_ALL_CATEGORY = 'ALL';

const LOCALE_KEY = 'onix-locale';
const catalogs = { ru, en } as const;
const listeners = new Set<() => void>();

let locale: Locale = 'ru';

function applyDocumentLang(next: Locale) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = next === 'ru' ? 'ru' : 'en';
}

/** Russian browser → ru. Any other language (EN, DE, CS, PL, …) → en. */
export function detectBrowserLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en';
  const tag = String(navigator.languages?.[0] || navigator.language || 'en').toLowerCase();
  if (tag === 'ru' || tag.startsWith('ru-')) return 'ru';
  return 'en';
}

export function readStoredLocale(): Locale | null {
  try {
    const v = localStorage.getItem(LOCALE_KEY);
    if (v === 'ru' || v === 'en') return v;
  } catch { /* ignore */ }
  return null;
}

export function resolveLocale(): Locale {
  return readStoredLocale() ?? detectBrowserLocale();
}

export function setLocale(next: Locale): void {
  locale = next;
  try { localStorage.setItem(LOCALE_KEY, next); } catch { /* ignore */ }
  applyDocumentLang(next);
  listeners.forEach((fn) => fn());
}

export function getLocale(): Locale {
  return locale;
}

export function subscribeLocale(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function bootLocale(): Locale {
  const next = resolveLocale();
  locale = next;
  applyDocumentLang(next);
  return next;
}

export function isMarketAllCategory(cat: string): boolean {
  return cat === MARKET_ALL_CATEGORY || cat === 'Все' || cat === 'All';
}

/** Translate a key; falls back to Russian, then the key. */
export function t(key: MessageKey): string {
  return catalogs[locale][key] ?? catalogs.ru[key] ?? key;
}

export function categoryLabel(cat: string): string {
  if (cat === 'OTHER') return t('market.other');
  return CATEGORY_LABELS[cat] ?? cat;
}

locale = typeof window === 'undefined' ? 'ru' : resolveLocale();
if (typeof window !== 'undefined') applyDocumentLang(locale);
