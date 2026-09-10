import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  isLiteralIpHost,
  originHostAllowed,
  originLaunchPosture,
  originSniAllowed,
  parseAllowedHosts,
} from '../src/http/origin-access.policy';
import { originEdgeSecretOk } from '../src/http/origin-access.middleware';

test('parseAllowedHosts strips scheme/port and lowercases', () => {
  const hosts = parseAllowedHosts({
    ALLOWED_HOSTS: 'https://www.onixtg.shop:443, ONIXTG.SHOP',
  } as NodeJS.ProcessEnv);
  assert.deepEqual(hosts, ['www.onixtg.shop', 'onixtg.shop']);
});

test('literal IP hosts are rejected', () => {
  assert.equal(isLiteralIpHost('158.160.116.199'), true);
  assert.equal(isLiteralIpHost('www.onixtg.shop'), false);
  assert.equal(originHostAllowed('158.160.116.199', ['www.onixtg.shop']), false);
  assert.equal(originHostAllowed('www.onixtg.shop', ['www.onixtg.shop', 'onixtg.shop']), true);
});

test('SNI literal IP rejected even when Host would be allowed', () => {
  const allowed = ['www.onixtg.shop'];
  assert.equal(originSniAllowed('158.160.116.199', allowed), false);
  assert.equal(originSniAllowed('www.onixtg.shop', allowed), true);
  assert.equal(originSniAllowed(undefined, allowed), true);
});

test('origin launch posture requires edge secret or grey-cloud ACK', () => {
  assert.equal(originLaunchPosture({} as NodeJS.ProcessEnv).ok, false);
  assert.equal(
    originLaunchPosture({ ORIGIN_GREY_CLOUD_ACK: 'grey-cloud-accepted' } as NodeJS.ProcessEnv).ok,
    true,
  );
  assert.equal(
    originLaunchPosture({ ORIGIN_EDGE_SECRET: 'x' } as NodeJS.ProcessEnv).mode,
    'edge-secret',
  );
});

test('edge secret gate', () => {
  assert.equal(originEdgeSecretOk({ headers: {} }, {} as NodeJS.ProcessEnv), true);
  assert.equal(
    originEdgeSecretOk(
      { headers: { 'x-onix-edge-secret': 'a' } },
      { ORIGIN_EDGE_SECRET: 'b' } as NodeJS.ProcessEnv,
    ),
    false,
  );
  assert.equal(
    originEdgeSecretOk(
      { headers: { 'x-onix-edge-secret': 'b' } },
      { ORIGIN_EDGE_SECRET: 'b' } as NodeJS.ProcessEnv,
    ),
    true,
  );
});

test('health bypass default is fail-closed for literal IP (source)', () => {
  const src = readFileSync('safe-deal-platform/src/http/origin-access.middleware.ts', 'utf8');
  assert.match(src, /ORIGIN_ALLOW_HEALTH_BYPASS \?\? 'false'/);
  assert.match(src, /literalIp/);
});
