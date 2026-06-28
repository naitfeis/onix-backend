import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Telegraf } from 'telegraf';

// 🔥 Инициализируем чистый прямой крипто-шлюз под твой токен для отправки чеков Гаранта пацанам
const bot = new Telegraf('8680400966:AAGhh79H0Ju6MA-RUdxccQIacIpTPntncXU');

@Injectable()
export class OrderNotificationListener {
  private readonly logger = new Logger(OrderNotificationListener.name);

  // 🛡️ СИНЬОР-ФИКС: Полностью выжжен неиспользуемый инжект Призмы для идеального клиринга варнинга TS6138!
  constructor() {}

  /**
   * 🔒 АСИНХРОННЫЙ ФОНОВЫЙ КЛИРИНГ: Перехватывает чеки Гаранта ONIX и шлет алерты в ТГ
   */
  @OnEvent('order.created')
  async handleOrderCreatedEvent(payload: { orderId: string; buyerId: string; sellerId: string; title: string; priceRub: number }) {
    this.logger.log(`[📡 ESCROW NOTIFICATION]: Запуск отправки чека для ордера #${payload.orderId}`);

    try {
      // 1. Отправляем алерт Покупателю лота
      await bot.telegram.sendMessage(
        payload.buyerId,
        `🔒 **ОПЛАТА В ГАРАНТ УСПЕШНО ЗАФИКСИРОВАНА**\n` +
        `───────────────────\n` +
        `📦 Предмет: ${payload.title}\n` +
        `💰 Сумма холда: ${payload.priceRub.toFixed(2)} ₽\n\n` +
        `*Деньги заморожены в сейфе ONIX. Ожидайте отгрузки товара продавцом.*`,
        { parse_mode: 'Markdown' }
      );

      // 2. Отправляем алерт Продавцу лота
      await bot.telegram.sendMessage(
        payload.sellerId,
        `💰 **У ВАС КУПИЛИ ТОВАР! ДЕНЬГИ В СЕЙФЕ ONIX**\n` +
        `───────────────────\n` +
        `📦 Лот: ${payload.title}\n` +
        `💵 Сумма: ${payload.priceRub.toFixed(2)} ₽\n\n` +
        `*Вам необходимо передать ценности покупателю в игре и нажать кнопку отгрузки лота.*`,
        { parse_mode: 'Markdown' }
      );

      this.logger.log(`[✅ ESCROW NOTIFICATION SUCCESS]: Чеки Гаранта успешно доставлены контрагентам!`);
    } catch (error: any) {
      this.logger.error(`[🚨 ESCROW NOTIFICATION CRASH]: Сбой отправки системного чека: ${error.message}`);
    }
  }
}