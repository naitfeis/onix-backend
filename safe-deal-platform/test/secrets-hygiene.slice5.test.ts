import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessSecrets,
  formatSecretsInventoryLine,
} from '../src/auth-v2/secrets-inventory';
import { EnvSecretsProvider } from '../src/auth-v2/secrets.provider';
import { SigningKeyService } from '../src/auth-v2/signing-key.service';
import { generateEd25519PemPair } from '../src/auth-v2/token.service';
import { redactSecrets } from '../src/safe-error-log';

test('redactSecrets strips DEVICE_HMAC_SECRET and JWT_SECRET assignments', () => {
  const raw =
    'DEVICE_HMAC_SECRET=super-hmac-secret-value JWT_SECRET=legacy-jwt-secret-at-least-32-chars!!';
  const out = redactSecrets(raw);
  assert.equal(out.includes('super-hmac-secret-value'), false);
  assert.equal(out.includes('legacy-jwt-secret'), false);
  assert.match(out, /\[REDACTED\]/);
});

test('redactSecrets strips AUTH_ED25519 PEM env assignments and PUBLIC KEY blocks', () => {
  const pem =
    '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEASECRETPUBLIC\n-----END PUBLIC KEY-----';
  const raw = `AUTH_ED25519_CURRENT_PRIVATE_PEM=-----BEGIN\\nSECRETKEY AUTH_ED25519_PREVIOUS_PUBLIC_PEM=x ${pem}`;
  const out = redactSecrets(raw);
  assert.equal(out.includes('SECRETKEY'), false);
  assert.equal(out.includes('SECRETPUBLIC'), false);
  assert.match(out, /\[REDACTED\]/);
});

test('redactSecrets strips PRODUCT_DELIVERY_KEY values', () => {
  const raw = 'PRODUCT_DELIVERY_KEY=dGVzdC1kZWxpdmVyeS1rZXktMzJieXRlcxh4eHg=';
  const out = redactSecrets(raw);
  assert.equal(out.includes('dGVzdC1kZWxpdmVyeS1rZXktMzJieXRlcxh4eHg='), false);
});

test('assessSecrets reports names only — never embeds env values', () => {
  const secret = 'must-never-appear-in-inventory-output-xyz';
  const env: Record<string, string | undefined> = {
    NODE_ENV: 'production',
    AUTH_ED25519_CURRENT_KID: 'kid-1',
    AUTH_ED25519_CURRENT_PRIVATE_PEM: secret,
    AUTH_ED25519_CURRENT_PUBLIC_PEM: secret,
    DEVICE_HMAC_SECRET: secret,
    JWT_SECRET: secret,
    BOT_TOKEN: '123456789:AABBCCDDEEFFGGHHIIJJKKLLMMNNOOPPQQR',
  };
  const items = assessSecrets(env, 'production');
  const line = formatSecretsInventoryLine(items);
  assert.equal(line.includes(secret), false);
  assert.equal(JSON.stringify(items).includes(secret), false);
  assert.ok(items.every((i) => i.name && (i.status === 'present' || i.status === 'missing')));
  assert.equal(items.find((i) => i.name === 'DEVICE_HMAC_SECRET')?.status, 'present');
  assert.equal(items.find((i) => i.name === 'AUTH_ED25519_PREVIOUS_KID')?.status, 'missing');
  assert.match(line, /secrets_inventory/);
  assert.match(line, /missing_required=\[\]/);
});

test('assessSecrets flags missing DEVICE_HMAC_SECRET as required in production', () => {
  const items = assessSecrets(
    {
      NODE_ENV: 'production',
      AUTH_ED25519_CURRENT_KID: 'k',
      AUTH_ED25519_CURRENT_PRIVATE_PEM: 'p',
      AUTH_ED25519_CURRENT_PUBLIC_PEM: 'u',
      JWT_SECRET: 'x'.repeat(32),
      BOT_TOKEN: '1:token',
    },
    'production',
  );
  const device = items.find((i) => i.name === 'DEVICE_HMAC_SECRET');
  assert.equal(device?.required, true);
  assert.equal(device?.status, 'missing');
  assert.match(formatSecretsInventoryLine(items), /missing_required=\[DEVICE_HMAC_SECRET\]/);
});

test('SigningKeyService verifies PREVIOUS after CURRENT rotation (Slice 5 hygiene)', () => {
  const oldPair = generateEd25519PemPair();
  const newPair = generateEd25519PemPair();
  process.env.AUTH_ED25519_CURRENT_KID = 'kid-new';
  process.env.AUTH_ED25519_CURRENT_PRIVATE_PEM = newPair.privatePem;
  process.env.AUTH_ED25519_CURRENT_PUBLIC_PEM = newPair.publicPem;
  process.env.AUTH_ED25519_PREVIOUS_KID = 'kid-old';
  process.env.AUTH_ED25519_PREVIOUS_PUBLIC_PEM = oldPair.publicPem;

  const keys = new SigningKeyService(new EnvSecretsProvider());
  keys.clearCache();
  const current = keys.getCurrentForSigning();
  assert.equal(current.kid, 'kid-new');
  assert.ok(current.privateKey);

  const verify = keys.getKeysForVerification();
  assert.equal(verify.length, 2);
  assert.ok(keys.findPublicKey('kid-old')?.publicKey);
  assert.ok(keys.findPublicKey('kid-new')?.publicKey);
  assert.equal(keys.findPublicKey('kid-old')?.role, 'PREVIOUS');
});
