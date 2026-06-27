import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter'; // Турбина асинхронных фоновых событий [проф. 1]
import { ProductController } from './product.controller';
import { UserController } from './user.controller'; // ИМПОРТИРУЕМ ЖИВОЙ ШЛЮЗ ПРОФИЛЕЙ И БАЛАНСОВ [проф. 1]
import { ChatController } from './chat.controller'; // ИМПОРТИРУЕМ ЖИВОЙ ШЛЮЗ ЧАТОВ И ОТЗЫВОВ [проф. 1]
import { ProductService } from './product.service';
import { PrismaService } from './prisma.service';
import { TelegramBotService } from './telegram-bot.service';
import { OrderNotificationListener } from './order-notification.listener'; // Наш фоновый воркер чеков Гаранта [проф. 1]

@Module({
  imports: [
    // Инициализируем шину асинхронных событий во всей экосистеме NestJS [проф. 1]
    EventEmitterModule.forRoot(),
  ],
  controllers: [
    ProductController,
    UserController, // РЕГИСТРИРУЕМ В ЯДРЕ: Шлюз авторизации и выдачи 5000 ₽ [проф. 1]
    ChatController  // РЕГИСТРИРУЕМ В ЯДРЕ: Живой чат-хаб и сохранение отзывов в Postgres [проф. 1]
  ],
  providers: [
    ProductService,
    PrismaService,
    TelegramBotService,
    OrderNotificationListener, // Фоновый обработчик нотификаций [проф. 1]
  ],
})
export class AppModule {}