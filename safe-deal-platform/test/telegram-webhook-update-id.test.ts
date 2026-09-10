import assert from 'node:assert/strict';
import test from 'node:test';
import { BotWebhookHandler, resetBotPromptDedupeForTests } from '../src/login-challenge/bot-webhook.handler';
import type { IdempotencyService, IdempotentResult } from '../src/idempotency/idempotency.service';

test('BotWebhookHandler durable update_id: second delivery is replayed, dispatch once', async () => {
  resetBotPromptDedupeForTests();
  delete process.env.TELEGRAM_WEBHOOK_SECRET;

  let dispatchCount = 0;
  const challenges = {
    openForBotPrompt: async () => {
      dispatchCount += 1;
      return {
        challengeId: 'ch_replay',
        status: 'OPENED',
        createdAt: new Date(),
        createdIp: '127.0.0.1',
        createdUserAgent: 'test',
        expiresAt: new Date(Date.now() + 60_000),
      };
    },
    confirmFromBot: async () => ({ challengeId: 'ch_replay', status: 'CONFIRMED' as const }),
    cancelFromBot: async () => ({ challengeId: 'ch_replay', status: 'EXPIRED' as const }),
    openLatestLiveForBareStart: async () => null,
  };

  process.env.BOT_TOKEN = 'test-token';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({ ok: true }),
  })) as typeof fetch;

  const seen = new Map<string, IdempotentResult<{ ok: true; prompted?: boolean }>>();
  const idempotency = {
    run: async (
      scope: string,
      key: string,
      _payload: unknown,
      execute: () => Promise<{ ok: true; prompted?: boolean }>,
    ) => {
      assert.equal(scope, 'telegram:webhook');
      const existing = seen.get(key);
      if (existing) return existing;
      const value = await execute();
      const stored = { kind: 'fresh' as const, value };
      seen.set(key, { kind: 'replay', value });
      return stored;
    },
  } as unknown as IdempotencyService;

  try {
    const handler = new BotWebhookHandler(challenges as never, {} as never, idempotency);
    const update = {
      update_id: 42_001,
      message: {
        text: '/start login_ch_replay',
        chat: { id: 1 },
        from: { id: 2, first_name: 'A' },
      },
    };
    const first = await handler.handle(undefined, update);
    const second = await handler.handle(undefined, update);
    assert.equal(first.prompted, true);
    assert.equal(second.prompted, true);
    assert.equal(dispatchCount, 1, 'replay must not re-enter login prompt path');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.BOT_TOKEN;
  }
});
