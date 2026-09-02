import assert from 'node:assert/strict';
import test from 'node:test';
import {
  escapeHtml,
  formatLoginConfirmPrompt,
  parseUserAgentHints,
} from '../src/login-challenge/login-challenge-prompt';
import {
  BotWebhookHandler,
  parseBotStartCommand,
  resetBotPromptDedupeForTests,
} from '../src/login-challenge/bot-webhook.handler';
import { LoginChallengeService } from '../src/login-challenge/login-challenge.service';
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
  resetBotPromptDedupeForTests();
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
    openLatestLiveForBareStart: async () => null,
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
  resetBotPromptDedupeForTests();
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
    openLatestLiveForBareStart: async () => null,
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
  resetBotPromptDedupeForTests();
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
    openLatestLiveForBareStart: async () => null,
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
  resetBotPromptDedupeForTests();
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
    openLatestLiveForBareStart: async () => null,
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
  assert.deepEqual(parseBotStartCommand('login_ch_abc'), { kind: 'login', payload: 'login_ch_abc' });
  assert.equal(parseBotStartCommand('hello').kind, 'none');
});

test('BotWebhookHandler bare /start replies with help instead of silence', async () => {
  resetBotPromptDedupeForTests();
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
    openLatestLiveForBareStart: async () => null,
  };

  try {
    const handler = new BotWebhookHandler(challenges as never);
    const result = await handler.handle(undefined, {
      message: {
        message_id: 901,
        text: '/start',
        chat: { id: 42 },
        from: { id: 7, first_name: 'Hiro' },
      },
    });
    assert.equal((result as { helped?: boolean }).helped, true);
    assert.equal(calls[0]?.method, 'sendMessage');
    assert.equal(calls[0]?.body.reply_to_message_id, 901);
    assert.match(String(calls[0]?.body.text), /Срок попытки входа истёк|ещё не начат/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.BOT_TOKEN;
  }
});

test('BotWebhookHandler bare /start recovers newest live challenge and sends confirm buttons', async () => {
  resetBotPromptDedupeForTests();
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
    openLatestLiveForBareStart: async () => ({ challengeId: 'ch_live' }),
    openForBotPrompt: async (id: string) => {
      assert.equal(id, 'ch_live');
      return {
        challengeId: id,
        status: 'OPENED',
        createdAt: new Date('2026-07-15T12:00:00.000Z'),
        createdIp: '198.51.100.7',
        createdUserAgent: 'Mozilla/5.0 Chrome/120.0.0.0',
        expiresAt: new Date('2026-07-15T12:02:00.000Z'),
      };
    },
    confirmFromBot: async () => ({ challengeId: 'ch_live', status: 'CONFIRMED' as const }),
    cancelFromBot: async () => ({ challengeId: 'ch_live', status: 'EXPIRED' }),
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
    assert.equal((result as { prompted?: boolean }).prompted, true);
    const keyboard = (calls[0]?.body.reply_markup as { inline_keyboard: Array<Array<{ callback_data?: string }>> })
      .inline_keyboard[0];
    assert.equal(keyboard[0].callback_data, 'confirm_login:ch_live');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.BOT_TOKEN;
  }
});

test('BotWebhookHandler expired payload recovers unclaimed live and buttons use recovered id', async () => {
  resetBotPromptDedupeForTests();
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
    openLatestLiveForBareStart: async () => ({ challengeId: 'ch_fresh' }),
    openForBotPrompt: async (id: string) => {
      if (id === 'ch_stale') {
        throw new AuthPlatformError('AUTH_LOGIN_CHALLENGE_EXPIRED', 'Login challenge expired.');
      }
      assert.equal(id, 'ch_fresh');
      return {
        challengeId: 'ch_fresh',
        status: 'OPENED',
        createdAt: new Date('2026-07-15T12:00:00.000Z'),
        createdIp: '198.51.100.7',
        createdUserAgent: 'Mozilla/5.0 Chrome/120.0.0.0',
        expiresAt: new Date('2026-07-15T12:10:00.000Z'),
      };
    },
    confirmFromBot: async () => ({ challengeId: 'ch_fresh', status: 'CONFIRMED' as const }),
    cancelFromBot: async () => ({ challengeId: 'ch_fresh', status: 'EXPIRED' }),
  };

  try {
    const handler = new BotWebhookHandler(challenges as never);
    const result = await handler.handle(undefined, {
      message: {
        text: '/start login_ch_stale',
        chat: { id: 42 },
        from: { id: 7, first_name: 'Hiro' },
      },
    });
    assert.equal((result as { prompted?: boolean }).prompted, true);
    const keyboard = (calls[0]?.body.reply_markup as { inline_keyboard: Array<Array<{ callback_data?: string }>> })
      .inline_keyboard[0];
    assert.equal(keyboard[0].callback_data, 'confirm_login:ch_fresh');
    assert.equal(keyboard[1].callback_data, 'cancel_login:ch_fresh');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.BOT_TOKEN;
  }
});

test('BotWebhookHandler expired payload does not attach a challenge claimed by another chat', async () => {
  resetBotPromptDedupeForTests();
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
    openLatestLiveForBareStart: async () => null,
    openForBotPrompt: async () => {
      throw new AuthPlatformError('AUTH_LOGIN_CHALLENGE_EXPIRED', 'Login challenge expired.');
    },
    confirmFromBot: async () => ({ challengeId: 'x', status: 'CONFIRMED' as const }),
    cancelFromBot: async () => ({ challengeId: 'x', status: 'EXPIRED' }),
  };

  try {
    const handler = new BotWebhookHandler(challenges as never);
    const result = await handler.handle(undefined, {
      message: {
        text: '/start login_ch_old',
        chat: { id: 7099007790 },
        from: { id: 7099007790, first_name: 'Hiro' },
      },
    });
    assert.equal((result as { prompted?: boolean }).prompted, false);
    assert.match(String(calls[0]?.body.text), /истёк/i);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.BOT_TOKEN;
  }
});

test('BotWebhookHandler claimed-by-other payload does not steal an unclaimed live login', async () => {
  resetBotPromptDedupeForTests();
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  process.env.BOT_TOKEN = 'test-token';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const url = String(_url);
    const method = url.split('/').pop() || 'unknown';
    calls.push({ method, body: JSON.parse(String(init?.body || '{}')) });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  let recovered = false;
  const challenges = {
    openLatestLiveForBareStart: async () => {
      recovered = true;
      return { challengeId: 'ch_other_site' };
    },
    openForBotPrompt: async () => {
      throw new AuthPlatformError(
        'AUTH_LOGIN_CHALLENGE_INVALID',
        'Login challenge is already claimed by another Telegram chat.',
      );
    },
    confirmFromBot: async () => ({ challengeId: 'x', status: 'CONFIRMED' as const }),
    cancelFromBot: async () => ({ challengeId: 'x', status: 'EXPIRED' }),
  };

  try {
    const handler = new BotWebhookHandler(challenges as never);
    await handler.handle(undefined, {
      message: {
        text: '/start login_ch_claimed',
        chat: { id: 1 },
        from: { id: 1, first_name: 'Hiro' },
      },
    });
    assert.equal(recovered, false);
    assert.match(String(calls[0]?.body.text), /недействительна/i);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.BOT_TOKEN;
  }
});

test('BotWebhookHandler skips a duplicate confirm prompt to the same chat within a few seconds', async () => {
  resetBotPromptDedupeForTests();
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
    openLatestLiveForBareStart: async () => null,
    openForBotPrompt: async () => ({
      challengeId: 'ch_dup',
      status: 'OPENED',
      createdAt: new Date('2026-07-15T12:00:00.000Z'),
      createdIp: '198.51.100.7',
      createdUserAgent: 'Mozilla/5.0 Chrome/120.0.0.0',
      expiresAt: new Date('2026-07-15T12:10:00.000Z'),
    }),
    confirmFromBot: async () => ({ challengeId: 'ch_dup', status: 'CONFIRMED' as const }),
    cancelFromBot: async () => ({ challengeId: 'ch_dup', status: 'EXPIRED' }),
  };

  try {
    const handler = new BotWebhookHandler(challenges as never);
    const first = await handler.handle(undefined, {
      message: { text: '/start login_ch_dup', chat: { id: 42 }, from: { id: 7, first_name: 'Hiro' } },
    });
    const second = await handler.handle(undefined, {
      message: { text: '/start login_ch_dup', chat: { id: 42 }, from: { id: 7, first_name: 'Hiro' } },
    });
    assert.equal((first as { prompted?: boolean }).prompted, true);
    assert.equal((second as { deduped?: boolean }).deduped, true);
    assert.equal(calls.filter((c) => c.method === 'sendMessage').length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.BOT_TOKEN;
  }
});

test('openLatestLiveForBareStart does not bind a challenge when claim loses to another chat', async () => {
  const repo = {
    findLatestLiveForChat: async () => null,
    findLatestLiveGlobal: async () => ({ id: 'ch_live', status: 'OPENED' }),
    claimTelegramChat: async () => false,
  };
  const svc = new LoginChallengeService(repo as never, {} as never);
  assert.equal(await svc.openLatestLiveForBareStart(7099007790), null);
});

test('openLatestLiveForBareStart claims an unclaimed live challenge for this chat', async () => {
  let claimedFor: bigint | null = null;
  const repo = {
    findLatestLiveForChat: async () => null,
    findLatestLiveGlobal: async () => ({ id: 'ch_unclaimed', status: 'CREATED' }),
    claimTelegramChat: async (_id: string, chatId: bigint) => {
      claimedFor = chatId;
      return true;
    },
  };
  const svc = new LoginChallengeService(repo as never, {} as never);
  const result = await svc.openLatestLiveForBareStart(42);
  assert.equal(result?.challengeId, 'ch_unclaimed');
  assert.equal(claimedFor, 42n);
});

test('openForBotPrompt refuses a live challenge already claimed by another Telegram chat', async () => {
  const repo = {
    findById: async () => ({
      id: 'ch_claimed',
      status: 'OPENED',
      telegramChatId: 8089505271n,
      expiresAt: new Date(Date.now() + 60_000),
      loginSessionId: 'ls-other',
    }),
  };
  const svc = new LoginChallengeService(repo as never, {} as never);
  await assert.rejects(
    () => svc.openForBotPrompt('ch_claimed', 7099007790),
    (error: unknown) => error instanceof AuthPlatformError
      && error.code === 'AUTH_LOGIN_CHALLENGE_INVALID',
  );
});

