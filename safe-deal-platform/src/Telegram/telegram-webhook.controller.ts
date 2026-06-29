import { Controller, Post, Param, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { TelegramBotService } from './telegram-bot.service';

@Controller('tg-webhook')
export class TelegramWebhookController {

  constructor(
    private readonly telegramBotService: TelegramBotService,
  ) {}

  @Post(':token')
  async handleWebhook(
    @Param('token') token: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {

    const expectedToken = process.env.TELEGRAM_BOT_TOKEN;

    if (token !== expectedToken) {
      res.sendStatus(403);
      return;
    }

    await this.telegramBotService.handleWebhookUpdate(req.body);

    res.sendStatus(200);
  }
}