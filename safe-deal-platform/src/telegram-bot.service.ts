import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Telegraf, Context } from 'telegraf';
import { PrismaService } from './prisma.service';

@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private bot?: Telegraf;

  constructor(private readonly prisma: PrismaService) {}

  // ИСПРАВЛЕНИЕ: Убрали ошибочный декоратор @
  async onModuleInit() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      this.logger.error('TELEGRAM_BOT_TOKEN is not defined in .env');
      throw new Error('Critical error: TELEGRAM_BOT_TOKEN not found in .env');
    }

    this.bot = new Telegraf(token);

    // ИСПРАВЛЕНИЕ: Явно указали тип Context для ctx, чтобы убрать ошибку TS7006
    this.bot.start(async (ctx: Context) => {
      try {
        // @ts-ignore
        const payload = ctx.payload;

        if (!payload || payload.trim() === '') {
          return ctx.reply(
            'Привет! Этот бот предназначен для интеграции с платформой ONIX P2P. Для привязки аккаунта используйте ссылку из личного кабинета.',
          );
        }

        if (!ctx.from) return;
        const telegramId = BigInt(ctx.from.id);
        const telegramNick = ctx.from.username ?? null;

        const user = await this.prisma.user.findUnique({
          where: { telegramToken: payload },
        });

        if (!user) {
          return ctx.reply(
            'Ошибка: Временный токен не найден или истёк срок действия. Пожалуйста, сгенерируйте новую ссылку на сайте.',
          );
        }

        if (user.telegramId !== undefined && user.telegramId !== null) {
          return ctx.reply(
            `⚠️ Ваш аккаунт уже привязан к этому Telegram-аккаунту.`,
          );
        }

        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            telegramId,
            telegramNick,
            telegramToken: null,
          },
        });

        const safeUsername = telegramNick ? `@${telegramNick}` : 'пользователь';

        return ctx.reply(
          `<strong>Успех!</strong>\n\nАккаунт пользователя ${safeUsername} успешно привязан к платформе ONIX P2P.`,
          { parse_mode: 'HTML' }
        );

      } catch (error) {
        this.logger.error(`Ошибка при обработке команды /start: ${error}`);
        return ctx.reply('Произошла внутренняя ошибка. Попробуйте позже.');
      }
    });

    const env = process.env.NODE_ENV;
    if (env === 'production') {
      // Запуск бота в продакшене через Webhook (закомментировано)
      // this.bot.launch({ webhook: { domain: process.env.WEBHOOK_URL } });
      this.logger.log('Запуск бота в режиме Webhook (Production)');
    } else {
      this.bot.launch();
      this.logger.log('🤖 Telegram-бот ONIX успешно запущен в режиме Long Polling (Development)');
    }
  }

  // ИСПРАВЛЕНИЕ: Убрали ошибочный декоратор @
  async onModuleDestroy() {
    if (this.bot) {
      await this.bot.stop('SIGINT');
      this.logger.log('Telegram-бот остановлен.');
    }
  }
}