import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { PrismaService } from './prisma.service';

import { TelegramModule } from './Telegram/telegram.module';

import { ProductController } from './product.controller';
import { UserController } from './user.controller';

import { ProductService } from './product.service';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    TelegramModule,
  ],

  controllers: [
    ProductController,
    UserController,
  ],

  providers: [
    PrismaService,
    ProductService,
  ],
})
export class AppModule {}