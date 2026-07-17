import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicTelegramNick, publicUsername } from '../src/public-username';

test('publicTelegramNick accepts real Telegram usernames', () => {
  assert.equal(publicTelegramNick('shoprub'), 'shoprub');
  assert.equal(publicTelegramNick('@Shop_Rub'), 'Shop_Rub');
});

test('publicTelegramNick rejects ids / names / onix', () => {
  assert.equal(publicTelegramNick('123456789'), null);
  assert.equal(publicTelegramNick('ONIX-7'), null);
  assert.equal(publicTelegramNick('PENDING-42'), null);
  assert.equal(publicTelegramNick('Иван'), null);
  assert.equal(publicTelegramNick('ab'), null);
  assert.equal(publicTelegramNick(null), null);
});

test('publicUsername never falls back to displayName/onix', () => {
  assert.equal(publicUsername('shoprub'), 'shoprub');
  assert.equal(publicUsername('12345'), 'user');
  assert.equal(publicUsername(undefined), 'user');
});
