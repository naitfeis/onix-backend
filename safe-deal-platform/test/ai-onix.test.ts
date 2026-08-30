import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConversationService } from '../src/ai/conversation.service';
import { IntentRecognizer } from '../src/ai/intent-recognizer';

describe('ONIX AI IntentRecognizer', () => {
  const ir = new IntentRecognizer();

  it('routes removed product and withdrawal phrases to help only', () => {
    assert.equal(ir.recognize('Создай товар'), 'HELP');
    assert.equal(ir.recognize('Добавить товар'), 'HELP');
    assert.equal(ir.recognize('Опубликовать'), 'HELP');
    assert.equal(ir.recognize('Вывести деньги'), 'HELP');
    assert.equal(ir.recognize('Сколько ждать вывод'), 'HELP');
  });

  it('keeps greetings, FAQ, and support contact', () => {
    assert.equal(ir.recognize('привет'), 'HELP');
    assert.equal(ir.recognize('Как работает система гаранта'), 'HELP');
    assert.equal(ir.recognize('Написать в поддержку'), 'CONTACT_SUPPORT');
    assert.equal(ir.recognize('напиши в поддержку: не пришёл товар'), 'CONTACT_SUPPORT');
  });
});

describe('ONIX AI removed side effects', () => {
  it('product and withdrawal phrases cannot create products or ledger effects', async () => {
    const effects: string[] = [];
    const prisma = {
      message: {
        findFirst: async () => null,
        create: async () => { effects.push('message.create'); },
      },
      product: {
        create: async () => { effects.push('product.create'); },
      },
      ledgerEntry: {
        create: async () => { effects.push('ledger.create'); },
      },
      userReport: {
        create: async () => { effects.push('report.create'); },
      },
    };
    const service = new ConversationService(prisma as never);
    const user = { id: 7n, onixId: '7' } as never;

    const productReply = await service.handleUserMessage(user, 'chat-1', 'Создай товар PUBG за 500 ₽');
    const withdrawReply = await service.handleUserMessage(user, 'chat-1', 'Вывести деньги');

    assert.match(productReply, /ONIX|Лот|товар/i);
    assert.match(withdrawReply, /Профиль|профил/i);
    assert.deepEqual(effects, []);
  });

  it('still creates an AI support report', async () => {
    const effects: string[] = [];
    const prisma = {
      message: { findFirst: async () => null },
      userReport: {
        create: async () => {
          effects.push('report.create');
          return { id: 'report123' };
        },
      },
    };
    const service = new ConversationService(prisma as never);
    const reply = await service.handleUserMessage(
      { id: 8n, onixId: '8' } as never,
      'chat-2',
      'Напиши в поддержку: не пришёл товар',
    );

    assert.match(reply, /Обращение отправлено/);
    assert.deepEqual(effects, ['report.create']);
  });
});
