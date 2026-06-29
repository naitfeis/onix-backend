import {
  Controller,
  Post,
  Req,
  Res,
  HttpCode,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { TelegramBotService } from './telegram-bot.service';

@Controller('telegram-webhook')
export class TelegramWebhookController {
  constructor(
    private readonly telegramBotService: TelegramBotService,
  ) {}

  @Post()
  @HttpCode(200)
  async handleWebhook(
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      console.log('[WEBHOOK] Update received');

      await this.telegramBotService.handleWebhookUpdate(req.body);

      return res.sendStatus(200);
    } catch (error) {
      console.error('[WEBHOOK ERROR]', error);

      return res.sendStatus(500);
    }
  }
}