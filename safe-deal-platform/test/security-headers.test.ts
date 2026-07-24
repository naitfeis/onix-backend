import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCorsOrigins } from '../src/security-headers';

test('resolveCorsOrigins excludes localhost in production by default', () => {
  const prevEnv = process.env.NODE_ENV;
  const prevCors = process.env.CORS_ORIGINS;
  try {
    delete process.env.CORS_ORIGINS;
    process.env.NODE_ENV = 'production';
    const origins = resolveCorsOrigins();
    assert.deepEqual(origins, ['https://www.onixtg.shop', 'https://onixtg.shop']);
    assert.ok(!origins.some((o) => o.includes('localhost')));
  } finally {
    process.env.NODE_ENV = prevEnv;
    if (prevCors === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = prevCors;
  }
});

test('resolveCorsOrigins honors explicit CORS_ORIGINS', () => {
  const prevEnv = process.env.NODE_ENV;
  const prevCors = process.env.CORS_ORIGINS;
  try {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS = 'https://www.onixtg.shop,http://localhost:5173';
    assert.deepEqual(resolveCorsOrigins(), ['https://www.onixtg.shop', 'http://localhost:5173']);
  } finally {
    process.env.NODE_ENV = prevEnv;
    if (prevCors === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = prevCors;
  }
});
