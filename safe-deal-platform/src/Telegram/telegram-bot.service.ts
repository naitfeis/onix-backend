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
  }

  async onModuleInit() {
    this.bot.start((ctx) => ctx.reply('Бот запущен'));

    this.bot.on('text', (ctx) => {
      ctx.reply(`Ты написал: ${ctx.message.text}`);
    });

    if (process.env.NODE_ENV === 'production') {
      const domain = process.env.WEBHOOK_DOMAIN;

      if (!domain) {
        throw new Error('WEBHOOK_DOMAIN отсутствует в .env');
      }

      const url = `${domain}/api/telegram-webhook`;

      try {
        // Проверяем текущий webhook
        const info = await this.bot.telegram.getWebhookInfo();

        // Если уже установлен нужный webhook — повторно не вызываем setWebhook()
        if (info.url !== url) {
          await this.bot.telegram.setWebhook(url);
          this.logger.log(`Webhook установлен: ${url}`);
        } else {
          this.logger.log('Webhook уже установлен.');
        }
      } catch (e: any) {
        this.logger.warn(`Не удалось установить webhook: ${e.message}`);
      }
    } else {
      await this.bot.launch();
      this.logger.log('Polling mode');
    }
  }

  async handleWebhookUpdate(update: any) {
    return this.bot.handleUpdate(update);
  }
}