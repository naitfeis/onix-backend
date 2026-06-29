import {
  Controller,
  Post,
  Req,
  Res,
  HttpCode,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { SkipTelegramAuth } from '../main';
import { TelegramBotService } from './telegram-bot.service';

@Controller('telegram-webhook')
@SkipTelegramAuth()
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
      await this.telegramBotService.handleWebhookUpdate(req.body);

      return res.sendStatus(200);
    } catch (error) {
      console.error('Telegram webhook error:', error);

      return res.sendStatus(500);
    }
}
}