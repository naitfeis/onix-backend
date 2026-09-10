/**
 * Safe Ed25519 access-JWT rotation helper.
 *
 * `auth:generate-ed25519` only mints a NEW CURRENT key — it does NOT promote the
 * old CURRENT to PREVIOUS. Clearing PREVIOUS before access TTL expires will
 * invalidate live JWTs mid-escrow.
 *
 * Usage:
 *   npm run auth:rotate-ed25519 -- --render
 *   npm run auth:rotate-ed25519 -- --retire-previous --confirm-ttl-elapsed-minutes=30
 */

import { generateKeyPairSync, randomBytes } from 'node:crypto';
import {
  accessTtlSeconds,
  assertMayRetirePrevious,
  minRetirePreviousMinutes,
} from '../src/auth-v2/ed25519-rotation-guard';

const CURRENT_KID = 'AUTH_ED25519_CURRENT_KID';
const CURRENT_PRIVATE = 'AUTH_ED25519_CURRENT_PRIVATE_PEM';
const CURRENT_PUBLIC = 'AUTH_ED25519_CURRENT_PUBLIC_PEM';
const PREVIOUS_KID = 'AUTH_ED25519_PREVIOUS_KID';
const PREVIOUS_PUBLIC = 'AUTH_ED25519_PREVIOUS_PUBLIC_PEM';

function parseKid(argv: string[]): string {
  const flag = argv.find((a) => a.startsWith('--kid='));
  if (flag) return flag.slice('--kid='.length).trim() || defaultKid();
  return defaultKid();
}

function defaultKid(): string {
  return `onix-ed25519-${randomBytes(4).toString('hex')}`;
}

function flagNumber(argv: string[], name: string): number | undefined {
  const flag = argv.find((a) => a.startsWith(`${name}=`));
  if (!flag) return undefined;
  const n = Number(flag.slice(name.length + 1));
  return Number.isFinite(n) ? n : undefined;
}

function pemToOneLine(pem: string): string {
  return pem.trim().replace(/\r\n/g, '\n').replace(/\n/g, '\\n');
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(
      `Missing ${name}. Load the live CURRENT signing env before rotating ` +
        '(Amvera/Render env → local shell), or this script cannot promote PREVIOUS safely.',
    );
  }
  return v;
}

function main(): void {
  const argv = process.argv.slice(2);
  const renderMode = argv.includes('--render');
  const retire = argv.includes('--retire-previous');

  if (retire) {
    const minutes = flagNumber(argv, '--confirm-ttl-elapsed-minutes');
    if (minutes === undefined) {
      throw new Error(
        'Retire mode requires --confirm-ttl-elapsed-minutes=N ' +
          `(N >= ${minRetirePreviousMinutes()}).`,
      );
    }
    assertMayRetirePrevious(minutes);
    console.log('=== Retire PREVIOUS (only after grace ≥ access TTL) ===');
    console.log('');
    console.log(`Confirmed elapsed minutes: ${minutes}`);
    console.log(`Access TTL seconds: ${accessTtlSeconds()}`);
    console.log('');
    console.log('Remove these env vars in ONE deploy, then redeploy:');
    console.log(`  ${PREVIOUS_KID}`);
    console.log(`  ${PREVIOUS_PUBLIC}`);
    console.log('');
    console.log('Do NOT touch CURRENT_* in the same change.');
    return;
  }

  const oldKid = requireEnv(CURRENT_KID);
  const oldPublic = requireEnv(CURRENT_PUBLIC);
  requireEnv(CURRENT_PRIVATE);

  const newKid = parseKid(argv);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

  console.log('=== ONIX Auth V2 Ed25519 ROTATION (atomic CURRENT→PREVIOUS + new CURRENT) ===');
  console.log('');
  console.log('Set ALL of the following in ONE deploy. Do not clear PREVIOUS in this step.');
  console.log('');

  if (renderMode) {
    console.log(`${PREVIOUS_KID}=${oldKid}`);
    console.log(`${PREVIOUS_PUBLIC}=${pemToOneLine(oldPublic)}`);
    console.log(`${CURRENT_KID}=${newKid}`);
    console.log(`${CURRENT_PRIVATE}=${pemToOneLine(privatePem)}`);
    console.log(`${CURRENT_PUBLIC}=${pemToOneLine(publicPem)}`);
  } else {
    console.log(`${PREVIOUS_KID}=${oldKid}`);
    console.log('');
    console.log(`${PREVIOUS_PUBLIC}=`);
    console.log(oldPublic.trimEnd());
    console.log('');
    console.log(`${CURRENT_KID}=${newKid}`);
    console.log('');
    console.log(`${CURRENT_PRIVATE}=`);
    console.log(privatePem.trimEnd());
    console.log('');
    console.log(`${CURRENT_PUBLIC}=`);
    console.log(publicPem.trimEnd());
  }

  console.log('');
  console.log(`After deploy: wait ≥ ${minRetirePreviousMinutes()} min (access TTL), then:`);
  console.log(
    `  npm run auth:rotate-ed25519 -- --retire-previous --confirm-ttl-elapsed-minutes=${minRetirePreviousMinutes()}`,
  );
  console.log('');
  console.log('Code-level guard: retire mode refuses N < AUTH_ACCESS_TTL_SECONDS/60.');
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
