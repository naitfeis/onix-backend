import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Telegraf } from 'telegraf';

@Injectable()
export class OrderNotificationListener implements OnModuleInit {
  private readonly logger = new Logger(OrderNotificationListener.name);
  private bot!: Telegraf;

  onModuleInit(): void {
    const token = process.env.BOT_TOKEN;
    if (!token) {
      this.logger.warn('[BOT] BOT_TOKEN не задан — уведомления в Telegram отключены.');
      return;
    }
    this.bot = new Telegraf(token);
    this.logger.log('[BOT] Telegram-шлюз уведомлений запущен.');
  }

  private async send(chatId: string | undefined, text: string): Promise<void> {
    if (!this.bot || !chatId) return;
    try {
      await this.bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });
    } catch (err) {
      this.logger.error(`[BOT SEND FAIL] chatId=${chatId}: ${(err as Error).message}`);
    }
  }

  // ─── Фаза 1: оплата зафиксирована ────────────────────────────────────────
  @OnEvent('order.created')
  async onOrderCreated(payload: {
    orderId: string;
    buyerTgId?: string;
    sellerTgId?: string;
    title: string;
    priceRub: number;
  }): Promise<void> {
    const price = payload.priceRub.toFixed(2);

    await this.send(
      payload.buyerTgId,
      `🔒 <b>ОПЛАТА В ГАРАНТ ЗАФИКСИРОВАНА</b>\n` +
      `─────────────────────\n` +
      `📦 Товар: ${payload.title}\n` +
      `💰 Сумма холда: ${price} ₽\n\n` +
      `Деньги заморожены в сейфе ONIX. Ожидайте отгрузки.`
    );

    await this.send(
      payload.sellerTgId,
      `💰 <b>У ВАС КУПИЛИ ТОВАР!</b>\n` +
      `─────────────────────\n` +
      `📦 Лот: ${payload.title}\n` +
      `💵 Сумма: ${price} ₽\n\n` +
      `Передайте товар покупателю в игре и нажмите кнопку отгрузки.`
    );

    this.logger.log(`[BOT] Чеки по ордеру #${payload.orderId} отправлены.`);
  }

  // ─── Фаза 2: продавец отгрузил ────────────────────────────────────────────
  @OnEvent('order.delivering')
  async onOrderDelivering(payload: {
    orderId: string;
    buyerId?: string;
  }): Promise<void> {
    await this.send(
      payload.buyerId,
      `📦 <b>ПРОДАВЕЦ ОТГРУЗИЛ ТОВАР</b>\n` +
      `─────────────────────\n` +
      `Ордер #${payload.orderId}\n\n` +
      `Проверьте инвентарь и подтвердите получение в приложении.`
    );
  }

  // ─── Фаза 3: сделка завершена ─────────────────────────────────────────────
  @OnEvent('order.completed')
  async onOrderCompleted(payload: {
    orderId: string;
    sellerTgId?: string;
    payoutRubles: string;
  }): Promise<void> {
    await this.send(
      payload.sellerTgId,
      `✅ <b>СДЕЛКА УСПЕШНО ЗАВЕРШЕНА</b>\n` +
      `─────────────────────\n` +
      `Ордер #${payload.orderId}\n` +
      `💵 Зачислено на баланс: <b>${payload.payoutRubles} ₽</b>\n\n` +
      `Средства доступны для вывода на карту.`
    );
  }

  // ─── Заявка на вывод ──────────────────────────────────────────────────────
  @OnEvent('withdrawal.created')
  async onWithdrawalCreated(payload: {
    withdrawalId: string;
    userTgId?: string;
    payoutRubles: string;
  }): Promise<void> {
    await this.send(
      payload.userTgId,
      `💳 <b>ЗАЯВКА НА ВЫВОД ПРИНЯТА</b>\n` +
      `─────────────────────\n` +
      `ID заявки: ${payload.withdrawalId}\n` +
      `К зачислению: <b>${payload.payoutRubles} ₽</b>\n` +
      `Комиссия: 50 ₽\n\n` +
      `Средства поступят на карту в течение обработки заявки.`
    );
  }
}