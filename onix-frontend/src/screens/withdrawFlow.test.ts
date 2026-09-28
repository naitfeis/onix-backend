import { describe, expect, it } from 'vitest';
import { MFA_TERMINAL_STATUSES, type MfaChallengeStatus } from '../api/contracts';
import { mfaModalHint, mfaStatusLabel, pollMfaStatus, type MfaStatusGetter } from './withdrawFlow';

const statuses = (rows: string[]): MfaStatusGetter => {
  let index = 0;
  return async () => ({ status: rows[Math.min(index++, rows.length - 1)] ?? 'PENDING' });
};

describe('pollMfaStatus', () => {
  it('stops on the first terminal status and allows retry only for CONFIRMED', () => {
    return pollMfaStatus('ch_1', statuses(['CONFIRMED']), { intervalMs: 0 }).then((result) => {
      expect(result).toEqual({ status: 'CONFIRMED', canRetry: true, timedOut: false });
    });
  });

  it('treats CONSUMED as terminal without offering another retry', () => {
    // Regression: the old poller watched VERIFIED/EXPIRED/CANCELED/FAILED, so a
    // challenge already spent by a parallel tab spun forever and the button
    // stayed enabled, inviting a duplicate payout attempt.
    return pollMfaStatus('ch_2', statuses(['CONSUMED']), { intervalMs: 0 }).then((result) => {
      expect(result.timedOut).toBe(false);
      expect(result.status).toBe('CONSUMED');
      expect(result.canRetry).toBe(false);
    });
  });

  it('keeps polling through PENDING until the challenge resolves', () => {
    const get = statuses(['PENDING', 'PENDING', 'CONFIRMED']);
    return pollMfaStatus('ch_3', get, { intervalMs: 0 }).then((result) => {
      expect(result.status).toBe('CONFIRMED');
      expect(result.canRetry).toBe(true);
    });
  });

  it('ignores transient fetch failures instead of ending the flow', () => {
    let calls = 0;
    const get: MfaStatusGetter = async () => {
      calls += 1;
      if (calls < 3) throw new Error('network blip');
      return { status: 'EXPIRED' };
    };
    return pollMfaStatus('ch_4', get, { intervalMs: 0 }).then((result) => {
      expect(result).toEqual({ status: 'EXPIRED', canRetry: false, timedOut: false });
      expect(calls).toBe(3);
    });
  });

  it('checks the deadline before the first poll', () => {
    let calls = 0;
    const get: MfaStatusGetter = async () => {
      calls += 1;
      return { status: 'PENDING' };
    };
    return pollMfaStatus('ch_5', get, { intervalMs: 0, timeoutMs: 0 }).then((result) => {
      expect(result.timedOut).toBe(true);
      expect(result.canRetry).toBe(false);
      expect(result.status).toBeNull();
      expect(calls).toBe(0);
    });
  });

  it('returns without polling when the caller already aborted', () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const get: MfaStatusGetter = async () => {
      calls += 1;
      return { status: 'PENDING' };
    };
    return pollMfaStatus('ch_6', get, { intervalMs: 0, signal: controller.signal }).then((result) => {
      expect(result.timedOut).toBe(true);
      expect(calls).toBe(0);
    });
  });
});

describe('mfa status copy', () => {
  it('never surfaces the raw enum value to the buyer', () => {
    const all: Array<MfaChallengeStatus | null> = [...MFA_TERMINAL_STATUSES, 'PENDING', null];
    for (const status of all) {
      const label = mfaStatusLabel(status);
      const hint = mfaModalHint(status);
      expect(label.length).toBeGreaterThan(0);
      expect(hint.length).toBeGreaterThan(0);
      expect(label).not.toMatch(/[A-Z_]{4,}/);
      expect(hint).not.toMatch(/[A-Z_]{4,}/);
    }
  });

  it('separates CONFIRMED from CONSUMED in the modal hint', () => {
    expect(mfaModalHint('CONFIRMED')).toMatch(/Повторить вывод/);
    expect(mfaModalHint('CONSUMED')).toMatch(/уже подтверждён/);
    expect(mfaModalHint('CONSUMED')).not.toMatch(/Повторить вывод/);
  });
});