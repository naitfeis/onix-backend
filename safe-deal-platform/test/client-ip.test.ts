import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatClientIpForPrompt,
  isLoopbackIp,
  normalizeIp,
  resolveClientIp,
} from '../src/http/client-ip';

test('normalizeIp strips IPv4-mapped and brackets', () => {
  assert.equal(normalizeIp('::ffff:185.1.2.3'), '185.1.2.3');
  assert.equal(normalizeIp('[2001:db8::1]'), '2001:db8::1');
  assert.equal(normalizeIp('10.0.0.1:443'), '10.0.0.1');
});

test('isLoopbackIp detects ::1 and 127.x', () => {
  assert.equal(isLoopbackIp('::1'), true);
  assert.equal(isLoopbackIp('127.0.0.1'), true);
  assert.equal(isLoopbackIp('185.10.20.30'), false);
});

test('resolveClientIp prefers CF-Connecting-IP', () => {
  const ip = resolveClientIp({
    ip: '::1',
    headers: {
      'cf-connecting-ip': '185.10.20.30',
      'x-forwarded-for': '1.1.1.1, 10.0.0.1',
    },
  });
  assert.equal(ip, '185.10.20.30');
});

test('resolveClientIp uses first public X-Forwarded-For hop', () => {
  const ip = resolveClientIp({
    ip: '10.0.0.5',
    headers: {
      'x-forwarded-for': '185.99.88.77, 172.16.0.2, 10.0.0.5',
    },
  });
  assert.equal(ip, '185.99.88.77');
});

test('resolveClientIp falls back to X-Real-IP', () => {
  const ip = resolveClientIp({
    ip: '::1',
    headers: { 'x-real-ip': '2001:db8::abcd' },
  });
  assert.equal(ip, '2001:db8::abcd');
});

test('resolveClientIp keeps Express ip when no proxy headers', () => {
  assert.equal(resolveClientIp({ ip: '::1', headers: {} }), '::1');
  assert.equal(resolveClientIp({ ip: '203.0.113.9', headers: {} }), '203.0.113.9');
});

test('formatClientIpForPrompt marks loopback', () => {
  assert.equal(formatClientIpForPrompt('::1'), '::1 (локально)');
  assert.equal(formatClientIpForPrompt('185.1.2.3'), '185.1.2.3');
  assert.equal(formatClientIpForPrompt(null), 'скрыт');
});

test('Amvera ignores spoofable CDN / XFF headers', () => {
  const prevA = process.env.AMVERA;
  const prevT = process.env.TRUST_CDN_HEADERS;
  process.env.AMVERA = '1';
  delete process.env.TRUST_CDN_HEADERS;
  try {
    const ip = resolveClientIp({
      ip: '203.0.113.9',
      headers: {
        'cf-connecting-ip': '8.8.8.8',
        'x-real-ip': '1.1.1.1',
        'x-forwarded-for': '9.9.9.9, 10.0.0.1',
      },
    });
    assert.equal(ip, '203.0.113.9');
  } finally {
    if (prevA === undefined) delete process.env.AMVERA;
    else process.env.AMVERA = prevA;
    if (prevT === undefined) delete process.env.TRUST_CDN_HEADERS;
    else process.env.TRUST_CDN_HEADERS = prevT;
  }
});
