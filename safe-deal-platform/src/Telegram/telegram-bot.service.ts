import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Telegraf } from 'telegraf';

@Injectable()
export class TelegramBotService implements OnModuleInit {
  private bot: Telegraf;
  private logger = new Logger(TelegramBotService.name);

  constructor() {
    const token = process.env.BOT_TOKEN;

    if (!token) {
      throw new Error('BOT_TOKEN отсутствует в .env');
    }

    this.bot = new Telegraf(token);

    // Глобальный обработчик ошибок Telegraf
    this.bot.catch((err) => {
      console.error('[TELEGRAF ERROR]');
      console.error(err);
    });
  }

  async onModuleInit() {
    // Команда /start
    this.bot.start(async (ctx) => {
      console.log('[BOT] /start');

      const result = await ctx.reply('Бот запущен');

      console.log('[BOT REPLY RESULT]');
      console.dir(result, { depth: null });
    });

    // Любое текстовое сообщение
    this.bot.on('text', async (ctx) => {
      console.log('[BOT] TEXT:', ctx.message.text);

      const result = await ctx.reply(
        `Ты написал: ${ctx.message.text}`,
      );

      console.log('[BOT TEXT RESULT]');
      console.dir(result, { depth: null });
    });

    if (process.env.NODE_ENV === 'production') {
      const domain = process.env.WEBHOOK_DOMAIN;

      if (!domain) {
        throw new Error('WEBHOOK_DOMAIN отсутствует в .env');
      }

      const url = `${domain}/api/telegram-webhook`;

      try {
        const info = await this.bot.telegram.getWebhookInfo();

        console.log('[WEBHOOK INFO]');
        console.dir(info, { depth: null });

        if (info.url !== url) {
          await this.bot.telegram.setWebhook(url);

          this.logger.log(`Webhook установлен: ${url}`);
        } else {
          this.logger.log('Webhook уже установлен.');
        }
      } catch (e: any) {
        this.logger.error('[WEBHOOK INSTALL ERROR]');
        console.error(e);

        throw e;
      }
    } else {
      await this.bot.launch();

      this.logger.log('Polling mode');
    }
  }

  async handleWebhookUpdate(update: any) {
    try {
      console.log('==============================');
      console.log('[TG UPDATE RECEIVED]');
      console.dir(update, { depth: null });
      console.log('==============================');

      await this.bot.handleUpdate(update);

      console.log('[TG SUCCESS]');
    } catch (e) {
      console.error('[TG ERROR]');
      console.error(e);

      throw e;
    }
  }
}