import assert from 'node:assert/strict';
import test from 'node:test';
import {
  escapeHtml,
  formatLoginConfirmPrompt,
  parseUserAgentHints,
} from '../src/login-challenge/login-challenge-prompt';
import { BotWebhookHandler, parseBotStartCommand } from '../src/login-challenge/bot-webhook.handler';
import { AuthPlatformError } from '../src/auth-v2/auth-errors';

test('parseUserAgentHints extracts Chrome on Windows', () => {
  const hints = parseUserAgentHints(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  );
  assert.equal(hints.browser, 'Chrome');
  assert.equal(hints.os, 'Windows 10/11');
});

test('parseUserAgentHints extracts Safari on iOS', () => {
  const hints = parseUserAgentHints(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  );
  assert.equal(hints.browser, 'Safari');
  assert.equal(hints.os, 'iOS');
});

test('formatLoginConfirmPrompt includes browser OS IP time and Website source', () => {
  const text = formatLoginConfirmPrompt(
    {
      createdAt: new Date('2026-07-15T12:00:00.000Z'),
      createdIp: '203.0.113.10',
      createdUserAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    'Alex',
    new Date('2026-07-15T12:00:30.000Z'),
  );
  assert.match(text, /Alex/);
  assert.match(text, /Website \(Telegram Bot Login\)/);
  assert.match(text, /Chrome/);
  assert.match(text, /macOS/);
  assert.match(text, /203\.0\.113\.10/);
  assert.match(text, /Время:/);
  assert.match(text, /Подтвердите или отмените/);
});

test('escapeHtml prevents HTML injection in prompt fields', () => {
  assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
});

test('BotWebhookHandler /start login_xxx sends confirm+cancel buttons with details', async () => {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  process.env.BOT_TOKEN = 'test-token';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const url = String(_url);
    const method = url.split('/').pop() || 'unknown';
    calls.push({ method, body: JSON.parse(String(init?.body || '{}')) });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  const challenges = {
    openForBotPrompt: async () => ({
      challengeId: 'ch_abc',
      status: 'OPENED',
      createdAt: new Date('2026-07-15T12:00:00.000Z'),
      createdIp: '198.51.100.7',
      createdUserAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      expiresAt: new Date('2026-07-15T12:02:00.000Z'),
    }),
    confirmFromBot: async () => ({ challengeId: 'ch_abc', status: 'CONFIRMED' as const }),
    cancelFromBot: async () => ({ challengeId: 'ch_abc', status: 'EXPIRED' }),
  };

  try {
    const handler = new BotWebhookHandler(challenges as never);
    const result = await handler.handle(undefined, {
      message: {
        text: '/start login_ch_abc',
        chat: { id: 42 },
        from: { id: 7, first_name: 'Hiro' },
      },
    });
    assert.equal(result.prompted, true);
    assert.equal(calls[0]?.method, 'sendMessage');
    const body = calls[0].body;
    assert.match(String(body.text), /Hiro/);
    assert.match(String(body.text), /198\.51\.100\.7/);
    assert.match(String(body.text), /Chrome/);
    assert.equal(body.parse_mode, 'HTML');
    const keyboard = (body.reply_markup as { inline_keyboard: Array<Array<{ callback_data?: string; text: string }>> })
      .inline_keyboard[0];
    assert.equal(keyboard.length, 2);
    assert.equal(keyboard[0].callback_data, 'confirm_login:ch_abc');
    assert.equal(keyboard[1].callback_data, 'cancel_login:ch_abc');
    assert.match(keyboard[0].text, /Подтвердить/);
    assert.match(keyboard[1].text, /Отменить/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.BOT_TOKEN;
  }
});

test('BotWebhookHandler confirm edits message to success without return URL', async () => {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  process.env.BOT_TOKEN = 'test-token';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const url = String(_url);
    const method = url.split('/').pop() || 'unknown';
    calls.push({ method, body: JSON.parse(String(init?.body || '{}')) });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  const challenges = {
    openForBotPrompt: async () => { throw new Error('unused'); },
    confirmFromBot: async (id: string, identity: { telegramId: bigint }) => {
      assert.equal(id, 'ch_ok');
      assert.equal(identity.telegramId, 99n);
      return { challengeId: id, status: 'CONFIRMED' as const };
    },
    cancelFromBot: async () => ({ challengeId: 'ch_ok', status: 'EXPIRED' }),
  };

  try {
    const handler = new BotWebhookHandler(challenges as never);
    const result = await handler.handle(undefined, {
      callback_query: {
        id: 'cb1',
        data: 'confirm_login:ch_ok',
        from: { id: 99, first_name: 'Hiro' },
        message: { message_id: 555, chat: { id: 42 } },
      },
    });
    assert.equal(result.confirmed, true);
    const edit = calls.find((c) => c.method === 'editMessageText');
    assert.ok(edit);
    assert.match(String(edit!.body.text), /Вход успешно подтверждён/);
    assert.equal(edit!.body.message_id, 555);
    const markup = edit!.body.reply_markup as { inline_keyboard: unknown[] };
    assert.deepEqual(markup.inline_keyboard, []);
    assert.ok(calls.some((c) => c.method === 'answerCallbackQuery'));
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.BOT_TOKEN;
  }
});

test('BotWebhookHandler cancel expires challenge and edits message', async () => {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  process.env.BOT_TOKEN = 'test-token';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const url = String(_url);
    const method = url.split('/').pop() || 'unknown';
    calls.push({ method, body: JSON.parse(String(init?.body || '{}')) });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  let cancelled = false;
  const challenges = {
    openForBotPrompt: async () => { throw new Error('unused'); },
    confirmFromBot: async () => ({ challengeId: 'ch_cancel', status: 'CONFIRMED' as const }),
    cancelFromBot: async (id: string) => {
      assert.equal(id, 'ch_cancel');
      cancelled = true;
      return { challengeId: id, status: 'EXPIRED' };
    },
  };

  try {
    const handler = new BotWebhookHandler(challenges as never);
    const result = await handler.handle(undefined, {
      callback_query: {
        id: 'cb2',
        data: 'cancel_login:ch_cancel',
        from: { id: 1 },
        message: { message_id: 9, chat: { id: 3 } },
      },
    });
    assert.equal(result.cancelled, true);
    assert.equal(cancelled, true);
    const edit = calls.find((c) => c.method === 'editMessageText');
    assert.ok(edit);
    assert.match(String(edit!.body.text), /Вход отменён/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.BOT_TOKEN;
  }
});

test('BotWebhookHandler /start with missing challenge sends error message', async () => {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  process.env.BOT_TOKEN = 'test-token';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const url = String(_url);
    const method = url.split('/').pop() || 'unknown';
    calls.push({ method, body: JSON.parse(String(init?.body || '{}')) });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  const challenges = {
    openForBotPrompt: async () => {
      throw new AuthPlatformError('AUTH_LOGIN_CHALLENGE_INVALID', 'not found');
    },
    confirmFromBot: async () => ({ challengeId: 'ch_cancel', status: 'CONFIRMED' as const }),
    cancelFromBot: async () => ({ challengeId: 'x', status: 'EXPIRED' }),
  };

  try {
    const handler = new BotWebhookHandler(challenges as never);
    await handler.handle(undefined, {
      message: {
        text: '/start login_missing',
        chat: { id: 1 },
        from: { id: 2, first_name: 'A' },
      },
    });
    assert.match(String(calls[0]?.body.text), /недействительна|не удалось найти/i);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.BOT_TOKEN;
  }
});

test('parseBotStartCommand accepts /start@bot login_ and bare /start', () => {
  assert.deepEqual(parseBotStartCommand('/start'), { kind: 'bare', payload: '' });
  assert.deepEqual(parseBotStartCommand('/start login_ch_abc'), { kind: 'login', payload: 'login_ch_abc' });
  assert.deepEqual(parseBotStartCommand('/start@Onixshop_bot login_ch_abc'), { kind: 'login', payload: 'login_ch_abc' });
  assert.deepEqual(parseBotStartCommand('/start mfa_step1'), { kind: 'mfa', payload: 'mfa_step1' });
  assert.equal(parseBotStartCommand('hello').kind, 'none');
});

test('BotWebhookHandler bare /start replies with help instead of silence', async () => {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  process.env.BOT_TOKEN = 'test-token';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const url = String(_url);
    const method = url.split('/').pop() || 'unknown';
    calls.push({ method, body: JSON.parse(String(init?.body || '{}')) });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  const challenges = {
    openForBotPrompt: async () => { throw new Error('must not look up a challenge'); },
    confirmFromBot: async () => ({ challengeId: 'x', status: 'CONFIRMED' as const }),
    cancelFromBot: async () => ({ challengeId: 'x', status: 'EXPIRED' }),
  };

  try {
    const handler = new BotWebhookHandler(challenges as never);
    const result = await handler.handle(undefined, {
      message: {
        text: '/start',
        chat: { id: 42 },
        from: { id: 7, first_name: 'Hiro' },
      },
    });
    assert.equal((result as { helped?: boolean }).helped, true);
    assert.equal(calls[0]?.method, 'sendMessage');
    assert.match(String(calls[0]?.body.text), /Голая команда \/start/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.BOT_TOKEN;
  }
});
