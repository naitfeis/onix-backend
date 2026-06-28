import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaService } from './prisma.service';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';
import { UserController } from './user.controller';
import { ChatController } from './chat.controller';
import { AdminController } from './admin/admin.controller';
import { OrderNotificationListener } from './order-notification.listener';

@Module({
  imports: [
    EventEmitterModule.forRoot({ wildcard: false, maxListeners: 10 }),
  ],
  controllers: [
    ProductController,
    UserController,
    ChatController,
    AdminController,
  ],
  providers: [
    PrismaService,
    ProductService,
    OrderNotificationListener,
  ],
})
export class AppModule {}