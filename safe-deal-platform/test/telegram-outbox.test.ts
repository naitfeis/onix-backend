import assert from 'node:assert/strict';
import test from 'node:test';
import { createDomainNotification, tryDeliverNotification } from '../src/domain-notify';
import { summarizeTelegramWebhookForLog } from '../src/login-challenge/bot-webhook.handler';

test('createDomainNotification truncates title/body to schema limits', async () => {
  let saved: { title: string; body: string } | undefined;
  const db = {
    notification: {
      create: async (args: { data: { title: string; body: string } }) => {
        saved = args.data;
        return { id: 1n };
      },
    },
  };
  await createDomainNotification(db as never, {
    userId: 1n,
    type: 'SYSTEM',
    title: 't'.repeat(200),
    body: 'b'.repeat(800),
  });
  assert.equal(saved?.title.length, 160);
  assert.equal(saved?.body.length, 500);
});

test('tryDeliverNotification stamps telegramPushedAt after Bot API ok', async () => {
  process.env.BOT_TOKEN = '123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 })) as typeof fetch;
  let stamped: Date | undefined;
  const db = {
    notification: {
      findUnique: async () => ({
        id: 9n,
        title: 'Hi',
        body: 'Body',
        telegramPushedAt: null,
        user: { telegramId: 111n },
      }),
      updateMany: async (args: { data: { telegramPushedAt: Date } }) => {
        stamped = args.data.telegramPushedAt;
        return { count: 1 };
      },
    },
  };
  try {
    const result = await tryDeliverNotification(db as never, 9n);
    assert.equal(result, 'delivered');
    assert.ok(stamped instanceof Date);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('tryDeliverNotification leaves row pending when Telegram fails', async () => {
  process.env.BOT_TOKEN = '123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: false, description: 'fail' }), { status: 500 })) as typeof fetch;
  let updates = 0;
  const db = {
    notification: {
      findUnique: async () => ({
        id: 9n,
        title: 'Hi',
        body: 'Body',
        telegramPushedAt: null,
        user: { telegramId: 111n },
      }),
      updateMany: async () => {
        updates += 1;
        return { count: 1 };
      },
    },
  };
  try {
    const result = await tryDeliverNotification(db as never, 9n);
    assert.equal(result, 'failed');
    assert.equal(updates, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('summarizeTelegramWebhookForLog omits message body and callback payload', () => {
  const log = summarizeTelegramWebhookForLog({
    update_id: 7,
    message: { text: '/start login_secret_payload', from: { id: 1 }, chat: { id: 1 } },
    callback_query: { id: 'q', data: 'confirm_login:ch_abc' },
  }, true);
  const json = JSON.stringify(log);
  assert.equal(json.includes('login_secret_payload'), false);
  assert.equal(json.includes('ch_abc'), false);
  assert.equal(log.startKind, 'login');
  assert.equal(log.callbackKind, 'confirm_login');
  assert.equal(log.textLen, '/start login_secret_payload'.length);
});
