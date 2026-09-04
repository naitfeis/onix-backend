import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chatAttachmentsUploadsEnabled } from '../src/chat-attachments/attachment-policy';

test('chat attachment uploads stay off unless explicitly enabled', () => {
  assert.equal(chatAttachmentsUploadsEnabled({}), false);
  assert.equal(chatAttachmentsUploadsEnabled({ CHAT_ATTACHMENTS_ENABLED: 'false' }), false);
  assert.equal(chatAttachmentsUploadsEnabled({ CHAT_ATTACHMENTS_ENABLED: 'true' }), true);
});
