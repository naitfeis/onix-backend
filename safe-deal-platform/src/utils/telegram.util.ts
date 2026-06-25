// @ts-ignore
import * as crypto from 'crypto';

/**
 * Набор утилит для работы с Telegram Bot API.
 * Обеспечивает безопасную генерацию токенов, построение ссылок и хэширование.
 */
export class TelegramUtil {
  // --- КОНФИГУРАЦИЯ И КОНСТАНТЫ ---

  /** @private */
  private static readonly MIN_BOT_USERNAME_LENGTH = 5;
  /** @private */
  private static readonly MAX_BOT_USERNAME_LENGTH = 32;
  /** @private */
  private static readonly BOT_USERNAME_REGEX = /^[a-z](?!.*__)[a-z0-9_]{3,30}bot$/i;

  // --- ГЕНЕРАЦИЯ ТОКЕНОВ ---

  /**
   * Генерирует криптографически стойкий случайный токен.
   * @param byteLength - Длина токена в байтах. Должна быть > 0.
   * @returns Токен в шестнадцатеричном виде.
   * @throws {Error} Если byteLength не является положительным целым числом.
   */
  static generateLinkingToken(byteLength: number = 16): string {
    if (!Number.isInteger(byteLength) || byteLength <= 0) {
      throw new Error('Token byte length must be a positive integer.');
    }
    return crypto.randomBytes(byteLength).toString('hex');
  }

  // --- РАБОТА С ССЫЛКАМИ (DEEP LINKS) ---

  /**
   * Формирует глубокую ссылку (Deep Link) для перехода в Telegram-бота.
   * Автоматически кодирует параметры для безопасности.
   * @param botUsername - Имя пользователя бота (например, 'MyTestBot').
   * @param token - Токен авторизации или связки.
   * @param startParam - Название параметра (по стандарту Telegram 'start').
   * @returns Полная URL-ссылка на бота.
   * @throws {Error} Если имя пользователя бота или токен невалидны.
   */
  static buildDeepLink(
    botUsername: string,
    token: string,
    startParam: string = 'start'
  ): string {
    // Валидация входных данных
    if (!this.isValidBotUsername(botUsername)) {
      // ИСПРАВЛЕНИЕ: Строки в кавычках
      throw new Error(
        `Invalid Telegram bot username: '${botUsername}'. ` +
        `It must be between ${this.MIN_BOT_USERNAME_LENGTH} and ${this.MAX_BOT_USERNAME_LENGTH} characters, ` +
        `start with a letter, and end with 'bot'.`
      );
    }

    if (!token || token.trim() === '') {
      throw new Error('Token must be a non-empty string.');
    }

    // ИСПРАВЛЕНИЕ: Обернули строку в кавычки
    const url = new URL(`https://t.me/${botUsername}`);
    url.searchParams.set(startParam, token);

    return url.toString();
  }

  /**
   * Проверяет валидность имени пользователя бота по правилам Telegram.
   * @param username - Имя пользователя для проверки.
   * @returns `true`, если имя валидно, иначе `false`.
   */
  static isValidBotUsername(username: string): boolean {
    return (
      username.length >= this.MIN_BOT_USERNAME_LENGTH &&
      username.length <= this.MAX_BOT_USERNAME_LENGTH &&
      this.BOT_USERNAME_REGEX.test(username)
    );
  }

  // --- КРИПТОГРАФИЯ (HMAC) ---

  /**
   * Генерирует HMAC-хэш для верификации данных от Telegram (например, для Webhook).
   * Важно: данные должны быть в виде строки (обычно это JSON.stringify(body)).
   * @param data - Данные для хэширования.
   * @param secret - Секретный ключ токена вашего бота.
   * @param algorithm - Алгоритм хэширования. По умолчанию 'sha256'.
   * @returns Хэш в шестнадцатеричном виде.
   * @throws {Error} Если алгоритм хэширования не поддерживается.
   */
  static generateHmac(data: string, secret: string, algorithm: string = 'sha256'): string {
    // ИСПРАВЛЕНИЕ: Добавлена проверка на поддержку алгоритма
    if (!crypto.getHashes().includes(algorithm)) {
      throw new Error(`Unsupported hash algorithm: ${algorithm}`);
    }
    return crypto.createHmac(algorithm, secret).update(data).digest('hex');
  }
}