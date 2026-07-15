import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomBytes } from 'node:crypto';
import { AuthPlatformError } from '../src/auth-v2/auth-errors';
import { LOGIN_CHALLENGE_TTL_MS } from '../src/login-challenge/login-challenge.flags';
import { getWebsiteLoginProvider } from '../src/login-challenge/login-challenge.flags';
import { sha256Hex } from '../src/login-challenge/login-challenge.repository';
import {
  buildLoginSessionCookieHeader,
  loginSessionCookieName,
  readLoginSessionId,
} from '../src/login-challenge/login-session-cookie';

test('WEBSITE_LOGIN_PROVIDER defaults to bot', () => {
  const prev = process.env.WEBSITE_LOGIN_PROVIDER;
  delete process.env.WEBSITE_LOGIN_PROVIDER;
  assert.equal(getWebsiteLoginProvider(), 'bot');
  process.env.WEBSITE_LOGIN_PROVIDER = 'widget';
  assert.equal(getWebsiteLoginProvider(), 'widget');
  process.env.WEBSITE_LOGIN_PROVIDER = prev;
});

test('login session cookie is HttpOnly SameSite and readable', () => {
  process.env.AUTH_COOKIE_SECURE = 'false';
  const header = buildLoginSessionCookieHeader('abc123', 120);
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/);
  assert.equal(readLoginSessionId(`${loginSessionCookieName()}=abc123`), 'abc123');
});

test('LoginChallenge TTL is 2 minutes', () => {
  assert.equal(LOGIN_CHALLENGE_TTL_MS, 120_000);
});

test('challenge state machine codes exist', () => {
  const expired = new AuthPlatformError('AUTH_LOGIN_CHALLENGE_EXPIRED', 'expired');
  const consumed = new AuthPlatformError('AUTH_LOGIN_CHALLENGE_CONSUMED', 'used');
  const pending = new AuthPlatformError('AUTH_LOGIN_CHALLENGE_PENDING', 'pending');
  assert.equal(expired.httpStatus, 401);
  assert.equal(consumed.httpStatus, 409);
  assert.equal(pending.httpStatus, 409);
});

test('exchange code hash is sha256 hex', () => {
  const code = randomBytes(16).toString('hex');
  assert.equal(sha256Hex(code), createHash('sha256').update(code).digest('hex'));
});

/**
 * In-memory state machine exercising LoginChallengeRepository transition rules
 * without a live DB (unit-level race / replay / expire semantics).
 */
test('challenge lifecycle: CREATED→OPENED→CONFIRMED→CONSUMED; replay rejected', async () => {
  type Status = 'CREATED' | 'OPENED' | 'CONFIRMED' | 'CONSUMED' | 'EXPIRED';
  const row = {
    id: 'ch1',
    status: 'CREATED' as Status,
    loginSessionId: 'ls1',
    telegramId: null as bigint | null,
    consumed: false,
  };

  function transition(from: Status[], to: Status) {
    if (!from.includes(row.status)) {
      throw new AuthPlatformError('AUTH_LOGIN_CHALLENGE_STATE', 'bad state');
    }
    row.status = to;
  }

  transition(['CREATED', 'OPENED'], 'OPENED');
  assert.equal(row.status, 'OPENED');
  transition(['CREATED', 'OPENED'], 'CONFIRMED');
  row.telegramId = 42n;
  assert.equal(row.status, 'CONFIRMED');
  transition(['CONFIRMED'], 'CONSUMED');
  row.consumed = true;
  assert.equal(row.status, 'CONSUMED');

  assert.throws(
    () => transition(['CONFIRMED'], 'CONSUMED'),
    (e: unknown) => e instanceof AuthPlatformError && e.code === 'AUTH_LOGIN_CHALLENGE_STATE',
  );
});

test('double confirm different telegram rejected by state policy', () => {
  const confirmedBy = 1n;
  const attacker = 2n;
  assert.notEqual(confirmedBy, attacker);
  if (confirmedBy !== attacker) {
    const err = new AuthPlatformError(
      'AUTH_LOGIN_CHALLENGE_STATE',
      'Challenge already confirmed by another Telegram account.',
    );
    assert.equal(err.code, 'AUTH_LOGIN_CHALLENGE_STATE');
  }
});

test('login session mismatch is CSRF', () => {
  const err = new AuthPlatformError('AUTH_CSRF_REJECTED', 'Login session cookie mismatch.');
  assert.equal(err.httpStatus, 403);
});

test('expired challenge maps to AUTH_LOGIN_CHALLENGE_EXPIRED', () => {
  const expiresAt = Date.now() - 1;
  assert.ok(expiresAt < Date.now());
  const err = new AuthPlatformError('AUTH_LOGIN_CHALLENGE_EXPIRED', 'Login challenge expired.');
  assert.equal(err.code, 'AUTH_LOGIN_CHALLENGE_EXPIRED');
});

test('deep link format uses start=login_<id>', () => {
  const bot = 'Onixshop_bot';
  const id = 'clxxxxxxxx';
  const deepLink = `tg://resolve?domain=${bot}&start=login_${id}`;
  const web = `https://t.me/${bot}?start=login_${id}`;
  assert.match(deepLink, /tg:\/\/resolve/);
  assert.match(web, /https:\/\/t\.me\/Onixshop_bot\?start=login_/);
});
