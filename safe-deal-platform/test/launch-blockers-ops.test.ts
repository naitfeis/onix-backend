import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('FE chat HTTP fallback polls when realtime socket is down', () => {
  const chats = readFileSync('onix-frontend/src/screens/Chats.tsx', 'utf8');
  assert.match(chats, /getRealtimeClient\(\)\.isReady\(\)/);
  assert.match(chats, /setInterval\(tick,\s*15_000\)/);
  assert.match(chats, /loadMessages\(threadId\)/);
});

test('realtime client reconnects after unexpected close', () => {
  const client = readFileSync('onix-frontend/src/realtime/client.ts', 'utf8');
  assert.match(client, /reconnect|scheduleReconnect|attempt/);
  assert.match(client, /intentionalClose/);
});

test('ops launch checklist covers firewall + backup + WS restart', () => {
  const readme = readFileSync('docs/architecture/ONIX-LAUNCH-BLOCKERS-OPS.md', 'utf8');
  assert.match(readme, /ALLOWED_HOSTS/);
  assert.match(readme, /ops:backup-drill/);
  assert.match(readme, /15s/);
  assert.match(readme, /CLAWBACK_DEBT/);
});
