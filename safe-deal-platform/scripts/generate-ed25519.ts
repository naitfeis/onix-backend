/**
 * Production helper — generate Ed25519 PEMs for Auth V2 SigningKeyService.
 *
 * Exact env names read by SigningKeyService (via EnvSecretsProvider):
 *   AUTH_ED25519_CURRENT_KID
 *   AUTH_ED25519_CURRENT_PRIVATE_PEM
 *   AUTH_ED25519_CURRENT_PUBLIC_PEM
 *
 * Does NOT change TokenService / SigningKeyService crypto — Node crypto ed25519 only.
 *
 * Usage:
 *   npm run auth:generate-ed25519
 *   npm run auth:generate-ed25519 -- --kid=onix-ed25519-1
 *   npm run auth:generate-ed25519 -- --render   # one-line PEM for Render dashboard
 */

import { generateKeyPairSync, randomBytes } from 'node:crypto';

function parseKid(argv: string[]): string {
  const flag = argv.find((a) => a.startsWith('--kid='));
  if (flag) return flag.slice('--kid='.length).trim() || defaultKid();
  return defaultKid();
}

function defaultKid(): string {
  return `onix-ed25519-${randomBytes(4).toString('hex')}`;
}

function pemToRenderOneLine(pem: string): string {
  // Render env UI often wants a single line; \n escapes are expanded by Node dotenv / many hosts.
  return pem.trim().replace(/\r\n/g, '\n').replace(/\n/g, '\\n');
}

function main(): void {
  const argv = process.argv.slice(2);
  const renderMode = argv.includes('--render');
  const kid = parseKid(argv);

  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

  if (renderMode) {
    console.log('# Paste into Render → Environment (values as single lines with \\n)');
    console.log(`AUTH_ED25519_CURRENT_KID=${kid}`);
    console.log(`AUTH_ED25519_CURRENT_PRIVATE_PEM=${pemToRenderOneLine(privatePem)}`);
    console.log(`AUTH_ED25519_CURRENT_PUBLIC_PEM=${pemToRenderOneLine(publicPem)}`);
    console.log('');
    console.log('# Optional after next Website bootstrap works with EdDSA on domain APIs:');
    console.log('# AUTH_ACCEPT_V2_ACCESS=true');
    return;
  }

  console.log('=== ONIX Auth V2 Ed25519 — SigningKeyService env ===');
  console.log('');
  console.log('Exact names (code: signing-key.service.ts):');
  console.log('  AUTH_ED25519_CURRENT_KID');
  console.log('  AUTH_ED25519_CURRENT_PRIVATE_PEM   ← NOT *_PRIVATE_KEY');
  console.log('  AUTH_ED25519_CURRENT_PUBLIC_PEM    ← NOT *_PUBLIC_KEY');
  console.log('');
  console.log(`AUTH_ED25519_CURRENT_KID=${kid}`);
  console.log('');
  console.log('AUTH_ED25519_CURRENT_PRIVATE_PEM=');
  console.log(privatePem.trimEnd());
  console.log('');
  console.log('AUTH_ED25519_CURRENT_PUBLIC_PEM=');
  console.log(publicPem.trimEnd());
  console.log('');
  console.log('--- Render one-liners ---');
  console.log(`npm run auth:generate-ed25519 -- --render --kid=${kid}`);
  console.log('');
  console.log('After setting env on Render: redeploy backend, then retry Bot Login complete.');
}

main();
