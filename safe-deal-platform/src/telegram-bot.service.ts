import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Telegraf, Context } from 'telegraf';
import { PrismaService } from './prisma.service';

@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private bot?: Telegraf;

  // URL твоего фронтенда. Когда настроим Cloudflare, здесь будет https://onixtg.shop
  private readonly MINI_APP_URL = 'http://localhost:5173';

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      this.logger.error('TELEGRAM_BOT_TOKEN is not defined in .env');
      throw new Error('Critical error: TELEGRAM_BOT_TOKEN not found in .env');
    }

    this.bot = new Telegraf(token);

    // 🚦 ГИБРИДНЫЙ ШЛЮЗ РЕГИСТРАЦИИ И ОНБОРДИНГА ONIX
    this.bot.start(async (ctx: Context) => {
      try {
        if (!ctx.from) return;
        const telegramId = BigInt(ctx.from.id);
        const telegramNick = ctx.from.username ?? null;

        // Безопасный вытаскивание токена из Telegraf-контекста без использования @ts-ignore
        const payload = (ctx as any).startPayload?.trim();

        let dbUser: any = null;

        // --- ВАРИАНТ А: Пацан пришел по ссылке привязки аккаунта с сайта ---
        if (payload && payload !== '') {
          dbUser = await this.prisma.user.findUnique({
            where: { telegramToken: payload },
          });

          if (!dbUser) {
            return ctx.reply(
              '🚨 **Ошибка верификации:** Временный токен не найден или истёк. Сгенерируйте новую ссылку в личном кабинете ONIX P2P.',
              { parse_mode: 'Markdown' }
            );
          }

          // Намертво привязываем Telegram ID к существующей строке в Postgres (Neon.tech)
          dbUser = await this.prisma.user.update({
            where: { id: dbUser.id },
            data: {
              telegramId,
              telegramNick,
              telegramToken: null, // Сжигаем одноразовый токен авторизации
            },
          });
          this.logger.log(`[LINK SUCCESS]: Аккаунт привязан. Порядковый ONIX-номер пацана: #${dbUser.id}`);
        }
        // --- ВАРИАНТ Б: Пацан пришел "с улицы" напрямую из поиска Telegram ---
        else {
          dbUser = await this.prisma.user.findUnique({
            where: { telegramId: telegramId },
          });

          if (!dbUser) {
            // База Postgres через @default(autoincrement()) автоматически выдает номер: 1, 2, 3...
            dbUser = await this.prisma.user.create({
              data: {
                telegramId,
                telegramNick,
                balanceCents: BigInt(0),
              },
            });
            this.logger.log(`[DIRECT REGISTER]: Новый юзер с улицы занесен в базу. Ему выдан номер: #${dbUser.id}`);
          }
        }

        // 📜 УСЛОВИЯ ПОЛЬЗОВАНИЯ И ДОГОВОР-ОФЕРТА БЕТЫ ONIX
        const termsText =
          `Привет, легенда! Твой профиль успешно запечатан в системе! 🏎️🥇\n\n` +
          `🆔 **ТВОЙ УНИКАЛЬНЫЙ ONIX-НОМЕР:** \`#${dbUser.id}\` (Ты зарегистрирован ${dbUser.id}-м по счету)\n\n` +
          `📜 **УСЛОВИЯ ПОЛЬЗОВАНИЯ (БЕТА-ТЕСТ №1):**\n` +
          `1. Платформа ONIX удерживает фиксированную маржу 2% с каждой успешной сделки на маркете [PDF: 0.1.7].\n` +
          `2. Комиссия на вывод средств на любые внешние платежные системы составляет 30 рублей.\n` +
          `3. Категорически запрещено подтверждать заказ до фактического получения скина в игре Standoff 2.\n` +
          `4. За попытку обмана Гаранта или фрод баланса — мгновенный перманентный бан по ID.\n\n` +
          `Нажимая инлайн-кнопки ниже, ты автоматически принимаешь правила экосистемы ONIX.`;

        // Выдаем красивый интерактивный инлайн-путь с нативными WebApp шторками Mini App
        return ctx.reply(termsText, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: 'Принять условия и Перейти на маркет 🛒',
                  web_app: { url: `${this.MINI_APP_URL}/market` }
                }
              ],
              [
                {
                  text: 'Начать торговать ⚔️',
                  web_app: { url: `${this.MINI_APP_URL}/trade` }
                }
              ]
            ]
          }
        });

      } catch (error) {
        this.logger.error(`Ошибка при обработке команды /start: ${error}`);
        return ctx.reply('🚨 Произошла внутренняя ошибка сервера ONIX Core. Попробуйте позже.');
      }
    });

    const env = process.env.NODE_ENV;
    if (env === 'production') {
      this.logger.log('Запуск бота в режиме Webhook (Production)');
    } else {
      this.bot.launch();
      this.logger.log('🤖 Telegram-бот ONIX успешно запущен в режиме Long Polling (Development)');
    }
  }

  async onModuleDestroy() {
    if (this.bot) {
      await this.bot.stop('SIGINT');
      this.logger.log('Telegram-бот остановлен.');
    }
  }

  // =====================================================================
  // 🛰️ СКВОЗНОЙ КАНАЛ ОТПРАВКИ ЧЕКОВ ГАРАНТА ИЗ ЛЮБОЙ ТОЧКИ NESTJS [PDF: 0.1.6]
  // =====================================================================
  async sendSystemNotification(telegramId: bigint, text: string) {
    if (!this.bot || !telegramId) {
      this.logger.warn('Попытка отправить уведомление, но бот не инициализирован или ID пуст.');
      return;
    }

    try {
      // Превращаем BigInt в строку, чтобы движок Telegraf без лагов проглотил ID
      await this.bot.telegram.sendMessage(telegramId.toString(), text, {
        parse_mode: 'Markdown',
      });
      this.logger.log(`[📩 ЧЕК ГАРАНТА]: Уведомление успешно доставлено юзеру ${telegramId}`);
    } catch (error) {
      this.logger.error(`[🚨 СБОЙ ОТПРАВКИ ЧЕКА]: Не удалось отправить сообщение для ${telegramId}: ${error}`);
    }
  }
}