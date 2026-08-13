import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeReviewText } from '../src/sanitize-user-text';

test('sanitizeReviewText strips HTML tags', () => {
  assert.equal(
    sanitizeReviewText('<script>alert(1)</script>Отличный продавец'),
    'alert(1)Отличный продавец',
  );
});

test('sanitizeReviewText neutralizes javascript: URLs', () => {
  const cleaned = sanitizeReviewText('[бонус](javascript:fetch("https://evil.test"))');
  assert.ok(cleaned);
  assert.equal(cleaned.includes('javascript:'), false);
  assert.equal(cleaned.includes('Javascript:'), false);
});

test('sanitizeReviewText returns undefined for empty leftover', () => {
  assert.equal(sanitizeReviewText('   <b></b>  '), undefined);
});
