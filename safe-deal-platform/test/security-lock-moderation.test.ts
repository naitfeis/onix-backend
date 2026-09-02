import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inspectDuplicateListing,
  inspectSpamBurst,
  inspectUserText,
  strongerHit,
} from '../src/risk/moderation-engine';
import { decideAction, riskLevel, scoreFactors } from '../src/risk/risk-engine.scoring';

test('off-platform payment phrasing triggers SECURITY_LOCK', () => {
  const hit = inspectUserText('давай без гаранта, переводи напрямую на карту');
  assert.ok(hit);
  assert.equal(hit.type, 'OFF_PLATFORM_PAYMENT');
  assert.equal(hit.action, 'SECURITY_LOCK');
});

test('external contact is moderation, not auto permanent ban', () => {
  const hit = inspectUserText('напиши мне в тг @someone');
  assert.ok(hit);
  assert.equal(hit.type, 'EXTERNAL_CONTACT');
  assert.equal(hit.action, 'MODERATION');
});

test('spam burst 5 is moderation, 12 is lock', () => {
  assert.equal(inspectSpamBurst(4), null);
  assert.equal(inspectSpamBurst(5)?.action, 'MODERATION');
  assert.equal(inspectSpamBurst(12)?.action, 'SECURITY_LOCK');
});

test('duplicate listings escalate', () => {
  assert.equal(inspectDuplicateListing('acc', 2), null);
  assert.equal(inspectDuplicateListing('acc', 3)?.type, 'DUPLICATE_LISTING');
});

test('strongerHit prefers lock over monitor', () => {
  const a = inspectUserText('https://bit.ly/abc');
  const b = inspectUserText('переводи напрямую на карту');
  const hit = strongerHit(a, b);
  assert.equal(hit?.action, 'SECURITY_LOCK');
});

test('BAN_EVASION factor is BLOCK; single CONTEXT_SHIFT at 80 stays MONITOR', () => {
  assert.equal(decideAction(80, ['CONTEXT_SHIFT']), 'MONITOR');
  assert.equal(decideAction(70, ['BAN_EVASION']), 'BLOCK');
  assert.equal(riskLevel(90, ['NEW_DEVICE']), 'CRITICAL');
  assert.equal(decideAction(90, ['NEW_DEVICE', 'NEW_IP', 'NEW_COUNTRY']), 'STEP_UP');
});

test('NEW_DEVICE + NEW_IP still STEP_UP, not auto-lock', () => {
  const factors = ['NEW_DEVICE', 'NEW_IP'] as const;
  const score = scoreFactors([...factors]);
  assert.equal(decideAction(score, [...factors]), 'STEP_UP');
});
