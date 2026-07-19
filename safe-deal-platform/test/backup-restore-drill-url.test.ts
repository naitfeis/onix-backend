import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Mirrors placeholder / protocol checks from backup-restore-drill.ts
 * (kept inline so the ops script stays a single runnable file).
 */

function isPlaceholderUrl(raw: string): boolean {
  const v = raw.trim();
  if (!v) return true;
  if (v === 'postgresql://...' || v === 'postgres://...') return true;
  if (/^postgres(ql)?:\/\/\.\.\./i.test(v)) return true;
  if (v.includes('://...')) return true;
  try {
    const u = new URL(v);
    const host = u.hostname.trim();
    if (!host || host === '...' || host === 'localhost.example' || host === 'example.com') return true;
    if (host.includes('...')) return true;
  } catch {
    return true;
  }
  return false;
}

function protocolOk(raw: string): boolean {
  try {
    const p = new URL(raw).protocol.replace(/:$/, '').toLowerCase();
    return p === 'postgresql' || p === 'postgres';
  } catch {
    return false;
  }
}

test('placeholder postgresql://... is rejected', () => {
  assert.equal(isPlaceholderUrl('postgresql://...'), true);
  assert.equal(isPlaceholderUrl('postgres://...'), true);
  assert.equal(isPlaceholderUrl('postgresql://user:pass@.../db'), true);
});

test('real neon-like URL is accepted', () => {
  const url = 'postgresql://neondb_owner:secret@ep-restless-shadow-ast1l4xu-pooler.c-4.eu-central-1.aws.neon.tech/neondb?sslmode=require';
  assert.equal(isPlaceholderUrl(url), false);
  assert.equal(protocolOk(url), true);
  const u = new URL(url);
  assert.equal(u.hostname.includes('neon.tech'), true);
  assert.ok(u.password.length > 0);
});

test('http URL is wrong protocol', () => {
  assert.equal(protocolOk('http://localhost:5432/db'), false);
});

test('empty / whitespace rejected', () => {
  assert.equal(isPlaceholderUrl(''), true);
  assert.equal(isPlaceholderUrl('   '), true);
});
