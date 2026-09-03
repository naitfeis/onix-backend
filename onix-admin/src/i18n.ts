export function ruRole(role: string) {
  return ({
    SUPER_ADMIN: 'Основатель',
    SECURITY_ADMIN: 'Безопасность',
    SUPPORT_ADMIN: 'Поддержка',
    FINANCE_ADMIN: 'Финансы',
    FOUNDER: 'Основатель',
  } as Record<string, string>)[role] ?? role;
}

export function ruOrderStatus(status: string) {
  return ({
    PENDING: 'Ожидает оплаты',
    PAYMENT_HOLD: 'Деньги в сейфе',
    DELIVERING: 'Передача',
    COMPLETED: 'Завершена',
    CANCELED: 'Отменена',
    DISPUTE: 'Спор',
    REFUNDED: 'Возврат',
  } as Record<string, string>)[status] ?? status;
}

export function ruProductStatus(status: string) {
  return ({
    ACTIVE: 'Активен',
    ARCHIVED: 'Снят',
    RESERVED: 'В сделке',
    SOLD_OUT: 'Нет в наличии',
  } as Record<string, string>)[status] ?? status;
}

export function ruPlatformStatus(status: string) {
  return ({
    USER: 'Пользователь',
    VERIFIED_SELLER: 'Проверенный продавец',
    MODERATOR: 'Модератор',
    ADMIN: 'Администратор',
    SUPER_ADMIN: 'Основатель',
    VIP: 'VIP',
    active: 'активен',
  } as Record<string, string>)[status] ?? status;
}

export function ruTicketStatus(status: string) {
  return ({
    OPEN: 'Открыт',
    IN_REVIEW: 'В работе',
    WAITING_USER: 'Ждём пользователя',
    RESOLVED: 'Решён',
    CLOSED: 'Закрыт',
  } as Record<string, string>)[status] ?? status;
}

export function ruTicketCategory(category: string) {
  return ({
    FRAUD_REPORT: 'Жалоба на мошенничество',
    RISK_ENGINE: 'Сигнал риска',
    BAN_EVASION: 'Обход блокировки',
    ACCOUNT_SECURITY: 'Безопасность аккаунта',
    BAN_APPEAL: 'Апелляция бана',
    SELL_BAN_APPEAL: 'Апелляция бана продаж',
    WITHDRAWAL_REVIEW: 'Проверка вывода',
    CHAT_ABUSE: 'Нарушение в чате',
    SPAM: 'Спам',
    HARASSMENT: 'Оскорбления',
    ORDER_DISPUTE: 'Спор по сделке',
    REFUND_REQUEST: 'Запрос возврата',
    ITEM_NOT_RECEIVED: 'Товар не получен',
    ITEM_NOT_AS_DESCRIBED: 'Товар не как в описании',
    ACCOUNT: 'Аккаунт',
    PAYMENT: 'Оплата',
    BUG: 'Ошибка',
    OTHER: 'Другое',
  } as Record<string, string>)[category] ?? category;
}

export function ruPriority(priority: string) {
  return ({
    LOW: 'низкий',
    MEDIUM: 'средний',
    HIGH: 'высокий',
    CRITICAL: 'критический',
  } as Record<string, string>)[priority] ?? priority;
}

export function ruRiskType(type: string) {
  return ({
    SESSION_ANOMALY: 'Странный вход',
    REFRESH_TOKEN_THEFT: 'Подозрение на кражу сессии',
    REFRESH_REUSE: 'Повторное использование сессии',
    LOGIN: 'Вход',
    BRUTEFORCE: 'Подбор пароля',
    TOO_MANY_LOGINS: 'Слишком много входов',
    IMPOSSIBLE_TRAVEL: 'Входы из разных мест сразу',
    ACCOUNT_TAKEOVER_SUSPECTED: 'Возможный захват аккаунта',
    REGISTRATION_BLOCKED: 'Регистрация отклонена',
    BAN_EVASION: 'Обход блокировки',
    OFF_PLATFORM_PAYMENT: 'Оплата вне площадки',
    EXTERNAL_CONTACT: 'Контакт вне площадки',
    SPAM: 'Спам',
    DUPLICATE_LISTING: 'Повтор лота',
    SUSPICIOUS_LINK: 'Подозрительная ссылка',
    FRAUD_ATTEMPT: 'Попытка мошенничества',
    SECURITY_LOCK: 'Блокировка безопасности',
    HIGH_RISK_THRESHOLD: 'Высокий риск',
  } as Record<string, string>)[type] ?? 'Событие безопасности';
}

export function ruRiskReason(reason: string) {
  return ({
    NEW_IP: 'Вход с нового адреса',
    'device seen on banned account': 'Это устройство уже встречалось на заблокированном аккаунте',
  } as Record<string, string>)[reason] ?? reason.replaceAll('_', ' ');
}

export function ruRiskLevel(level: string) {
  return ({
    CRITICAL: 'критический',
    HIGH: 'высокий',
    MEDIUM: 'средний',
    LOW: 'низкий',
  } as Record<string, string>)[level] ?? level;
}

export function ruFactor(factor: string) {
  return ({
    NEW_IP: 'новый адрес',
    LOGIN: 'вход',
  } as Record<string, string>)[factor] ?? factor.replaceAll('_', ' ').toLowerCase();
}

export function ruRiskAction(action: string) {
  return ({
    LOG: 'записали',
    ALERT: 'уведомили',
    LOCK: 'ограничили доступ',
    CHALLENGE: 'запросили подтверждение',
    BAN: 'заблокировали',
  } as Record<string, string>)[action] ?? action;
}

export function ruLedgerType(type: string) {
  return ({
    DEPOSIT: 'Пополнение',
    PURCHASE_HOLD: 'Оплата в сейф',
    REFUND: 'Возврат',
    SALE_PAYOUT: 'Выплата за продажу',
    ADMIN_ADJUSTMENT: 'Корректировка',
    WITHDRAWAL: 'Вывод',
    DEPOSIT_FUND: 'Залог',
    DEPOSIT_RETURN: 'Возврат залога',
  } as Record<string, string>)[type] ?? 'Операция';
}

export function humanPayload(payload: Record<string, unknown>): string[] {
  const lines: string[] = [];
  if (typeof payload.kind === 'string') lines.push(`Тип: ${ruRiskType(payload.kind)}`);
  if (typeof payload.level === 'string') lines.push(`Уровень: ${ruRiskLevel(payload.level)}`);
  if (typeof payload.score === 'number') lines.push(`Оценка: ${payload.score}`);
  if (Array.isArray(payload.factors)) {
    lines.push(`Признаки: ${payload.factors.map((item) => ruFactor(String(item))).join(', ')}`);
  }
  if (Array.isArray(payload.reasons)) {
    lines.push(`Почему: ${payload.reasons.map((item) => ruRiskReason(String(item))).join('; ')}`);
  }
  if (payload.trustedDevice === false) lines.push('Устройство не в списке доверенных');
  if (payload.deviceIdPresent === true) lines.push('Устройство опознано');
  if (payload.locale == null) lines.push('Язык устройства не передан');
  if (payload.timezone == null) lines.push('Часовой пояс не передан');
  if (typeof payload.refreshGeneration === 'number') {
    lines.push(`Сессия обновлялась ${payload.refreshGeneration} раз`);
  }
  const related = payload.related as { orderId?: string; listingId?: string; chatId?: string } | undefined;
  if (related?.orderId) lines.push(`Сделка: ${related.orderId}`);
  if (related?.listingId) lines.push(`Лот: ${related.listingId}`);
  if (related?.chatId) lines.push('Есть связанный чат');
  return lines;
}

export function humanFlag(flag: Record<string, unknown>): string[] {
  const lines: string[] = [];
  if (typeof flag.reason === 'string') {
    lines.push(
      flag.reason === 'New account received ACCOUNT sale proceeds'
        ? 'Новый аккаунт получил выплату за продажу аккаунта'
        : ruRiskReason(flag.reason),
    );
  }
  if (typeof flag.code === 'string') lines.push(ruRiskType(flag.code));
  if (typeof flag.severity === 'string') lines.push(`Уровень: ${ruRiskLevel(flag.severity)}`);
  if (typeof flag.status === 'string') lines.push(`Статус: ${flag.status === 'ACTIVE' ? 'действует' : flag.status}`);
  if (typeof flag.restrictedAccountSaleCents === 'string' || typeof flag.restrictedAccountSaleCents === 'number') {
    const n = Number(flag.restrictedAccountSaleCents);
    if (Number.isFinite(n)) {
      lines.push(`Ограничение продаж аккаунтов: ${new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(n / 100)}`);
    }
  }
  if (typeof flag.protectionUntil === 'string') {
    lines.push(`Защита до ${new Date(flag.protectionUntil).toLocaleString('ru-RU')}`);
  }
  return lines.length ? lines : ['Флаг безопасности'];
}

export function ruAuditAction(action: string) {
  return ({
    ADMIN_PRODUCT_ARCHIVE: 'Снял лот',
    ADMIN_MESSAGE_DELETE: 'Удалил сообщение',
    ADMIN_ORDER_REFUND: 'Вернул деньги покупателю',
    ADMIN_ORDER_COMPLETE: 'Подтвердил выплату продавцу',
    ORDER_COMPLETE: 'Завершил сделку',
    ORDER_REFUND: 'Оформил возврат',
    USER_BAN: 'Забанил пользователя',
    USER_UNBAN: 'Снял бан',
    STAFF_CREATE: 'Создал сотрудника',
    STAFF_DELETE: 'Удалил сотрудника',
  } as Record<string, string>)[action] ?? 'Действие администратора';
}

export function ruMetaKey(key: string) {
  return ({
    sellerId: 'продавец',
    title: 'название',
    reason: 'причина',
    chatId: 'чат',
    support: 'поддержка',
    fromStatus: 'было',
    orderId: 'сделка',
    listingId: 'лот',
  } as Record<string, string>)[key] ?? key;
}
