import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter'; // Турбина асинхронных фоновых событий [проф. 1]
import { ProductController } from './product.controller';
import { UserController } from './user.controller'; // ИМПОРТИРУЕМ ЖИВОЙ ШЛЮЗ ПРОФИЛЕЙ И БАЛАНСОВ [проф. 1]
import { ChatController } from './chat.controller'; // ИМПОРТИРУЕМ ЖИВОЙ ШЛЮЗ ЧАТОВ И ОТЗЫВОВ [проф. 1]
import { ProductService } from './product.service';
import { PrismaService } from './prisma.service';
import { OrderNotificationListener } from './order-notification.listener'; // Наш фоновый воркер чеков Гаранта [проф. 1]

// 🛡️ СИНЬОР-РЕФАКТОРИНГ: Полностью выжжен легаси-модуль TelegramBotService, ломавший Long Polling! [проф. 1]
@Module({
  imports: [
    // Инициализируем шину асинхронных событий во всей экосистеме NestJS [проф. 1]
    EventEmitterModule.forRoot(),
  ],
  controllers: [
    ProductController,
    UserController, // РЕГИСТРИРУЕМ В ЯДРЕ: Шлюз авторизации и выдачи баланса [проф. 1]
    ChatController  // РЕГИСТРИРУЕМ В ЯДРЕ: Живой чат-хаб и сохранение отзывов в Postgres [проф. 1]
  ],
  providers: [
    ProductService,
    PrismaService,
    OrderNotificationListener, // Фоновый обработчик нотификаций [проф. 1]
  ],
})
export class AppModule {}