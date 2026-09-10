import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isLiteralIpHost,
  originEdgeSecretOk,
  originHostAllowed,
  parseAllowedHosts,
} from '../src/http/origin-access.middleware';

test('parseAllowedHosts strips scheme/port and lowercases', () => {
  const hosts = parseAllowedHosts({
    ALLOWED_HOSTS: 'https://www.onixtg.shop:443, ONIXTG.SHOP',
  } as NodeJS.ProcessEnv);
  assert.deepEqual(hosts, ['www.onixtg.shop', 'onixtg.shop']);
});

test('literal IP hosts are rejected', () => {
  assert.equal(isLiteralIpHost('158.160.116.199'), true);
  assert.equal(isLiteralIpHost('www.onixtg.shop'), false);
  assert.equal(
    originHostAllowed('158.160.116.199', ['www.onixtg.shop']),
    false,
  );
  assert.equal(
    originHostAllowed('www.onixtg.shop', ['www.onixtg.shop', 'onixtg.shop']),
    true,
  );
});

test('edge secret gate', () => {
  assert.equal(
    originEdgeSecretOk({ headers: {} }, {} as NodeJS.ProcessEnv),
    true,
  );
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
