import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeReviewText, sanitizeChatText } from '../src/sanitize-user-text';

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

test('sanitizeChatText strips tags and caps length', () => {
  assert.equal(sanitizeChatText('<script>x</script>привет'), 'xпривет');
  assert.equal(sanitizeChatText('javascript:alert(1)').includes('javascript:'), false);
  assert.equal(sanitizeChatText('a'.repeat(5000), 2000).length, 2000);
  assert.equal(sanitizeChatText('   '), '');
});
