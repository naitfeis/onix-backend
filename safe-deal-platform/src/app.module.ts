import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';

// Prisma
import { PrismaService } from './prisma.service';

// Telegram
import { TelegramModule } from './Telegram/telegram.module';
import { TelegramBotService } from './Telegram/telegram-bot.service';
import { TelegramWebhookController } from './Telegram/telegram-webhook.controller';

// Controllers
import { ProductController } from './product.controller';
import { UserController } from './user.controller';

// Services
import { ProductService } from './product.service';

@Module({
  imports: [
    EventEmitterModule.forRoot(),   // <-- ЭТОГО НЕ ХВАТАЛО
    TelegramModule,
  ],

  controllers: [
    ProductController,
    UserController,
    TelegramWebhookController,
  ],

  providers: [
    PrismaService,
    ProductService,
    TelegramBotService,
  ],
})
export class AppModule {}