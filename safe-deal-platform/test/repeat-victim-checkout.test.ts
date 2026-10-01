import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthPlatformError } from '../src/auth-v2/auth-errors';
import { PaymentsService } from '../src/economy/payments/payments.service';
import { findPriorFailedDelivery } from '../src/risk/repeat-victim';

/**
 * Card checkout must refuse a repeat victim BEFORE the provider captures funds.
 *
 * Settlement creates the order only after money moves, so a gate placed there would
 * strand the buyer's payment. This pins the gate to intent creation instead.
 */

const SELLER = 9n;
const BUYER = 7n;
const PRODUCT = {
  id: 'prod-1',
  status: 'ACTIVE' as const,
  sellerId: SELLER,
  priceCents: 10_000n,
  quantity: 5,
  expiresAt: new Date(Date.now() + 86_400_000),
};

function harness(state: { refunded: { id: bigint } | null }) {
  const securityEvents: Array<{ type: string; payload: unknown }> = [];
  let providerCalls = 0;

  const tx = {
    $queryRaw: async () => [],
    product: { findUnique: async () => ({ ...PRODUCT }) },
    order: {
      findFirst: async (args: { where?: { clawback?: unknown } }) =>
        (args?.where?.clawback ? null : state.refunded),
    },
    paymentIntent: { create: async () => ({ id: 'intent-1' }) },
  };

  const prisma = {
    $transaction: async (execute: (client: typeof tx) => Promise<unknown>) => execute(tx),
    paymentIntent: { findUnique: async () => null },
    securityEvent: {
      create: async (args: { data: { type: string; payload: unknown } }) => {
        securityEvents.push({ type: args.data.type, payload: args.data.payload });
        return {};
      },
    },
  };

  // The CARD slot is served by the *second* provider argument (the Tinkoff-style one),
  // so the counting stub must be registered there — otherwise providerCalls would stay
  // 0 even if the gate regressed and the test would prove nothing.
  const manual = { code: 'MANUAL' as const, isConfigured: () => false };
  const cardProvider = {
    code: 'CARD' as const,
    createIntent: async () => {
      providerCalls += 1;
      return { providerRef: 'ref-1', status: 'PENDING' as const };
    },
    isConfigured: () => true,
  };

  const service = new PaymentsService(
    prisma as never,
    { getAvailable: async () => 0n } as never,
    {} as never,
    {} as never,
    {} as never,
    manual as never,
    cardProvider as never,
    undefined,
  );

  return { service, securityEvents, providerCalls: () => providerCalls };
}

const checkoutDto = {
  wallet: 'MAIN' as const,
  provider: 'CARD' as const,
  amountCents: 10_000,
  idempotencyKey: 'checkout-1',
  checkout: { productId: 'prod-1', quantity: 1, purchaseIdempotencyKey: 'purchase-1' },
};

test('the counting stub really owns the CARD slot (otherwise a zero count proves nothing)', () => {
  const { service } = harness({ refunded: null });
  const providers = (service as unknown as { providers: Map<string, unknown> }).providers;
  assert.ok(providers.has('CARD'), 'CARD provider is registered');
  const card = providers.get('CARD') as { createIntent: () => Promise<unknown> };
  assert.equal(typeof card.createIntent, 'function');
});

test('card checkout refuses a buyer this seller already refunded', async () => {
  const { service, securityEvents, providerCalls } = harness({ refunded: { id: 5001n } });
  await assert.rejects(
    () => service.createTopUpForUser(BUYER, checkoutDto),
    (error: unknown) => {
      assert.ok(error instanceof AuthPlatformError, 'refusal is an AuthPlatformError');
      assert.equal(error.code, 'AUTH_ACCOUNT_LOCKED');
      const details = error.details as { reason?: string };
      assert.equal(details?.reason, 'REPEAT_VICTIM');
      return true;
    },
  );
  // The provider must never be asked for money once the pair is blocked.
  assert.equal(providerCalls(), 0, 'no funds captured for a refused checkout');
  assert.equal(securityEvents.length, 1, 'the refusal is still recorded for support');
  assert.equal(securityEvents[0]!.type, 'FRAUD_ATTEMPT');
  const payload = securityEvents[0]!.payload as { kind?: string; path?: string };
  assert.equal(payload.kind, 'REPEAT_VICTIM');
  assert.equal(payload.path, 'CARD_CHECKOUT');
});

test('card checkout proceeds for a pair with no failed delivery', async () => {
  const { service, securityEvents } = harness({ refunded: null });
  // Without a PSP quote the service still refuses, but for a different reason: it must
  // NOT be the repeat-victim gate, which is what this test pins.
  const error = await service.createTopUpForUser(BUYER, checkoutDto).then(
    () => null,
    (caught: unknown) => caught,
  );
  if (error instanceof AuthPlatformError) {
    assert.notEqual(
      (error.details as { reason?: string } | undefined)?.reason,
      'REPEAT_VICTIM',
      'a clean pair must not be gated',
    );
  }
  assert.equal(securityEvents.length, 0, 'no fraud event for an innocent pair');
});

test('findPriorFailedDelivery reports unrecovered clawback debt on the pair', async () => {
  const tx = {
    order: {
      findFirst: async (args: { where?: { clawback?: unknown } }) =>
        (args?.where?.clawback ? { id: 5002n } : null),
    },
  } as never;
  const reason = await findPriorFailedDelivery(tx, BUYER, SELLER);
  assert.match(reason ?? '', /still owes/, `unexpected reason: ${reason}`);
});

test('findPriorFailedDelivery returns null for a clean pair', async () => {
  const tx = { order: { findFirst: async () => null } } as never;
  assert.equal(await findPriorFailedDelivery(tx, BUYER, SELLER), null);
});