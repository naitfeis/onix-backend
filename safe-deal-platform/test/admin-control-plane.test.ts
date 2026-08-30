import assert from 'node:assert/strict';
import test from 'node:test';
import { AdminSecurityService } from '../src/admin/admin-security.service';

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
  const service = new AdminSecurityService(prisma as never, {} as never, {} as never, {} as never);
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
