import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { pickProviderCheckoutMetadata } from '../src/economy/payments/payments.service';

const repoFile = (path: string) => readFileSync(path, 'utf8');

test('provider QR/redirect metadata is persisted for the checkout modal', () => {
  // Regression: createTopUp used to rebuild intent.metadata from the claim plus
  // payWay only, dropping every field the PSP returned. getIntent() serves the
  // stored row, so the buyer saw neither a QR image nor «Открыть оплату».
  const service = repoFile('safe-deal-platform/src/economy/payments/payments.service.ts');
  assert.match(service, /\.\.\.pickProviderCheckoutMetadata\(created\.metadata\)/);
  // The merge must still keep the claim metadata (checkout stock bookkeeping).
  assert.match(service, /claim\.metadata && typeof claim\.metadata === 'object'/);
});

test('provider metadata is allowlisted, not copied wholesale', () => {
  const picked = pickProviderCheckoutMetadata({
    channel: 'tinkoff',
    payWay: 'sbp',
    paymentUrl: 'https://securepay.tinkoff.ru/html/payments/form/?PaymentId=123',
    paymentId: '123',
    qrPayload: 'https://qr.nspk.ru/AS1234',
    qrImageBase64: 'iVBORw0KGgo=',
    sandbox: true,
    injectedKey: 'malicious',
    nested: { deep: 'value' },
  });

  assert.equal(picked.injectedKey, undefined);
  assert.equal(picked.nested, undefined);
  assert.equal(picked.channel, 'tinkoff');
  assert.equal(picked.payWay, 'sbp');
  assert.equal(picked.qrPayload, 'https://qr.nspk.ru/AS1234');
  assert.equal(picked.qrImageBase64, 'iVBORw0KGgo=');
  assert.equal(picked.sandbox, true);
  assert.equal(
    picked.paymentUrl,
    'https://securepay.tinkoff.ru/html/payments/form/?PaymentId=123',
  );
});

test('paymentUrl must be https before it can become a window.open target', () => {
  const base = { channel: 'tinkoff', payWay: 'card' };
  assert.equal(
    pickProviderCheckoutMetadata({ ...base, paymentUrl: 'http://insecure.example/pay' }).paymentUrl,
    undefined,
  );
  assert.equal(
    pickProviderCheckoutMetadata({ ...base, paymentUrl: 'javascript:alert(1)' }).paymentUrl,
    undefined,
  );
  assert.equal(
    pickProviderCheckoutMetadata({ ...base, paymentUrl: 'https://ok.example/pay with space' }).paymentUrl,
    undefined,
  );
  // Card flow legitimately has no redirect URL when only a QR was issued.
  assert.equal(pickProviderCheckoutMetadata(base).paymentUrl, undefined);
});

test('oversized QR bodies are dropped instead of bloating the intent row', () => {
  const huge = 'A'.repeat(512_001);
  const picked = pickProviderCheckoutMetadata({ qrImageBase64: huge, qrPayload: 'https://qr.nspk.ru/X' });
  assert.equal(picked.qrImageBase64, undefined);
  // The copyable payload survives so the buyer can still pay.
  assert.equal(picked.qrPayload, 'https://qr.nspk.ru/X');
});

test('junk input never throws and yields an empty object', () => {
  assert.deepEqual(pickProviderCheckoutMetadata(undefined), {});
  assert.deepEqual(pickProviderCheckoutMetadata(null), {});
  assert.deepEqual(pickProviderCheckoutMetadata('nope'), {});
  assert.deepEqual(pickProviderCheckoutMetadata(42), {});
  assert.deepEqual(pickProviderCheckoutMetadata([]), {});
  assert.deepEqual(pickProviderCheckoutMetadata({ paymentUrl: '', qrPayload: '' }), {});
});