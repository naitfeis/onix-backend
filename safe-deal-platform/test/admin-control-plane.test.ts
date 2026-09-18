import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AdminSecurityService,
  aggregateRiskAnalytics,
} from '../src/admin/admin-security.service';

test('risk analytics reports buckets, factors, shadow locks, and proxy denominator', () => {
  const analytics = aggregateRiskAnalytics([
    { payload: { score: 10, factors: ['NEW_IP'] } },
    {
      payload: {
        score: 90,
        factors: ['BAN_EVASION', 'NEW_IP'],
        enforcementMode: 'shadow',
        wouldHaveLocked: true,
        wouldHaveLockedLevel: 'CRITICAL',
      },
    },
    { payload: { factors: ['NEW_DEVICE'] } },
  ], [
    { action: 'SECURITY_UNLOCK' },
    { action: 'SECURITY_REDUCE_RESTRICTIONS' },
    { action: 'SECURITY_KEEP_LOCK' },
    { action: 'SECURITY_PERMANENT_BAN' },
  ]);

  assert.equal(analytics.eventDenominator, 3);
  assert.equal(analytics.scoreDenominator, 2);
  assert.equal(analytics.scoreBuckets.find((bucket) => bucket.label === '0-24')?.count, 1);
  assert.equal(analytics.scoreBuckets.find((bucket) => bucket.label === '85-100')?.count, 1);
  assert.deepEqual(analytics.factorCounts, { NEW_IP: 2, BAN_EVASION: 1, NEW_DEVICE: 1 });
  assert.deepEqual(analytics.wouldLock, { count: 1, byLevel: { CRITICAL: 1 } });
  assert.equal(analytics.falsePositiveProxy.label, 'falsePositiveProxy');
  assert.equal(analytics.falsePositiveProxy.numerator, 2);
  assert.equal(analytics.falsePositiveProxy.denominator, 4);
  assert.equal(analytics.falsePositiveProxy.rate, 0.5);
  assert.match(analytics.falsePositiveProxy.definition, /not an actual false-positive rate/i);
});

test('global message moderation writes immutable admin audit entry', async () => {
  let updated: unknown;
  let audit: any;
  const tx = {
    message: {
      update: async (args: unknown) => { updated = args; return args; },
    },
    adminActionLog: {
      create: async (args: any) => { audit = args; return args; },
    },
  };
  const prisma = {
    message: {
      findUnique: async () => ({
        id: 42n,
        chatId: 'chat-1',
        senderId: 9n,
        deletedAt: null,
      }),
    },
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  };
  const service = new AdminSecurityService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const result = await service.moderateMessage(
    { id: 7n, email: 'security@example.com', role: 'SECURITY_ADMIN', sessionId: 'session-1' },
    '42',
    'fraud link',
  );

  assert.deepEqual(result, { id: '42', deleted: true });
  assert.ok(updated);
  assert.equal(audit.data.adminUserId, 7n);
  assert.equal(audit.data.action, 'ADMIN_MESSAGE_DELETE');
  assert.equal(audit.data.targetType, 'Message');
  assert.equal(audit.data.targetId, '42');
  assert.deepEqual(audit.data.metadataJson, { chatId: 'chat-1', reason: 'fraud link' });
});

test('PRO mutation audit records separate admin actor and customer target', async () => {
  let pending: any;
  let completed: any;
  const prisma = {
    user: {
      findFirst: async () => ({ id: 42n, onixId: '000042' }),
    },
    adminActionLog: {
      create: async (args: any) => {
        pending = args;
        return { id: 88n };
      },
      update: async (args: any) => {
        completed = args;
        return args;
      },
    },
  };
  const pro = {
    grantFromAdminPlane: async (userId: bigint) => ({ id: 'subscription-1', userId }),
  };
  const service = new AdminSecurityService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    pro as never,
  );

  await service.grantPro(
    { id: 7n, email: 'root@example.com', role: 'SUPER_ADMIN', sessionId: 'session-1' },
    'ONIX-000042',
  );

  assert.equal(pending.data.adminUserId, 7n);
  assert.equal(pending.data.targetType, 'User');
  assert.equal(pending.data.targetId, '42');
  assert.equal(pending.data.action, 'ADMIN_PRO_GRANT_PENDING');
  assert.equal(completed.data.action, 'ADMIN_PRO_GRANT');
  assert.equal(completed.data.metadataJson.state, 'COMPLETED');
});
