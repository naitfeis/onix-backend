import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from './prisma.service';
import { TelegramBotService } from './telegram-bot.service';

@Injectable()
export class OrderNotificationListener {
  // Исправлено: Неиспользуемый логгер полностью удален, ошибка TS6133 уничтожена!

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegramBot: TelegramBotService,
  ) {}

  @OnEvent('order.initiated')
  async handleOrderInitiated(payload: { orderId: string; buyerId: bigint; sellerId: bigint; price: string }) {
    const [buyer, seller] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: payload.buyerId } }),
      this.prisma.user.findUnique({ where: { id: payload.sellerId } }),
    ]);

    const buyerText =
      `🛍️ **ONIX ГАРАНТ // СРЕДСТВА ЗАМОРОЖЕНЫ**\n\n` +
      `📦 Контракт: \`№${payload.orderId}\`\n` +
      `💵 Сумма: **${payload.price} ₽**\n` +
      `🛡️ Статус: \`PAYMENT_HOLD\`\n\n` +
      `⚠️ **КРИТИЧЕСКИ ВАЖНО:** Ожидайте выдачи товара. **НЕ ПОДТВЕРЖДАЙТЕ ЗАКАЗ ДО ВЫДАЧИ ТОВАРА!** Если нажмёте кнопку раньше времени — деньги уйдут мошеннику!`;

    const sellerText =
      `🚨 **ТВОЙ ЛОТ ВЫКУПИЛИ // ДЕНЬГИ В СЕЙФЕ**\n\n` +
      `📦 Контракт: \`№${payload.orderId}\`\n` +
      `💰 Сумма: **${payload.price} ₽**\n\n` +
      `Выдайте товар покупателю в игре, затем нажмите на сайте кнопку «Я передал товар»!`;

    if (buyer?.telegramId) await this.telegramBot.sendSystemNotification(buyer.telegramId, buyerText);
    if (seller?.telegramId) await this.telegramBot.sendSystemNotification(seller.telegramId, sellerText);
  }

  @OnEvent('order.delivering')
  async handleOrderDelivering(payload: { orderId: string; buyerId: bigint; productTitle: string }) {
    const buyer = await this.prisma.user.findUnique({ where: { id: payload.buyerId } });
    if (buyer?.telegramId) {
      const text =
        `📦 **ПРОДАВЕЦ ЗАЯВИЛ О ВЫДАЧЕ ТОВАРА!**\n\n` +
        `Ордер: \`№${payload.orderId}\`\n` +
        `Товар: **${payload.productTitle}**\n\n` +
        `Проверьте баланс в игре. Если всё пришло без обмана — жмите кнопку **«Товар получил»** на сайте.`;
      await this.telegramBot.sendSystemNotification(buyer.telegramId, text);
    }
  }

  @OnEvent('order.completed')
  async handleOrderCompleted(payload: { orderId: string; buyerId: bigint; sellerId: bigint; totalPrice: string; commission: string; payout: string }) {
    const [buyer, seller] = await Promise.all([

      this.prisma.user.findUnique({ where: { id: payload.buyerId } }),
      this.prisma.user.findUnique({ where: { id: payload.sellerId } }),
    ]);

    if (buyer?.telegramId) {
      const text = `🎉 **КОНТРАКТ №${payload.orderId} ЗАВЕРШЕН**\n\nСпасибо, что выбрали Гарант-сервис **ONIX | SSSF**!`;
      await this.telegramBot.sendSystemNotification(buyer.telegramId, text);
    }
    if (seller?.telegramId) {
      const text =
        `⚡️ **МОМЕНТАЛЬНЫЙ ПЕРЕВОД НА КАРТУ ЗАПУЩЕН!**\n\n` +
        `Покупатель подтвердил получение по ордеру \`№${payload.orderId}\`.\n` +
        `💰 Сумма сделки: **${payload.totalPrice}.00 ₽**\n` +
        `📊 Комиссия вывода (5%): **${payload.commission} ₽**\n` +
        `💳 **ЗАЧИСЛЕНИЕ НА КАРТУ**: **${payload.payout} ₽**\n\n` +
        `Поступление в течение 10 секунд! 🏎️🔥`;
      await this.telegramBot.sendSystemNotification(seller.telegramId, text);
    }
  }
}