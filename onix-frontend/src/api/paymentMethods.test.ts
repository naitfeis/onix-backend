import { afterEach, describe, expect, it } from 'vitest';
import { API_PATHS } from './contracts';
import {
  PAYMENT_METHODS_UNKNOWN,
  cachedPaymentMethods,
  fetchPaymentMethods,
  resetPaymentMethodsCache,
} from './paymentMethods';

afterEach(() => {
  resetPaymentMethodsCache();
});

describe('fetchPaymentMethods', () => {
  it('asks the public availability endpoint', async () => {
    const paths: string[] = [];
    const get = async <T,>(path: string): Promise<T> => {
      paths.push(path);
      return { sbp: true, card: false, sandbox: true } as T;
    };
    const result = await fetchPaymentMethods(get);
    expect(paths).toEqual([API_PATHS.paymentsMethods]);
    expect(result).toEqual({ sbp: true, card: false, sandbox: true });
  });

  it('serves one HTTP call for many concurrent callers', async () => {
    let calls = 0;
    const get = async <T,>(_path: string): Promise<T> => {
      calls += 1;
      await Promise.resolve();
      return { sbp: true, card: true, sandbox: false } as T;
    };
    const results = await Promise.all([
      fetchPaymentMethods(get),
      fetchPaymentMethods(get),
      fetchPaymentMethods(get),
    ]);
    expect(calls).toBe(1);
    for (const row of results) expect(row.sbp).toBe(true);
  });

  it('coerces a sloppy payload instead of advertising an unavailable PSP', async () => {
    // Regression guard: a truthy-but-not-true value must not enable СБП/card,
    // otherwise the buyer walks the whole checkout into a provider 403.
    const get = async <T,>(_path: string): Promise<T> => ({
      sbp: 'yes',
      card: 1,
      sandbox: 'false',
    } as T);
    const result = await fetchPaymentMethods(get);
    expect(result).toEqual({ sbp: false, card: false, sandbox: false });
  });

  it('falls back to balance-only when the API is unreachable', async () => {
    const get = async <T,>(_path: string): Promise<T> => {
      throw new Error('offline');
    };
    const result = await fetchPaymentMethods(get);
    expect(result).toEqual(PAYMENT_METHODS_UNKNOWN);
    // A failure must not poison the cache: the next call may succeed.
    expect(cachedPaymentMethods()).toEqual(PAYMENT_METHODS_UNKNOWN);
    const ok = async <T,>(_path: string): Promise<T> => ({ sbp: true, card: true, sandbox: false } as T);
    expect(await fetchPaymentMethods(ok)).toEqual({ sbp: true, card: true, sandbox: false });
  });

  it('memoizes a successful response', async () => {
    let calls = 0;
    const get = async <T,>(_path: string): Promise<T> => {
      calls += 1;
      return { sbp: false, card: true, sandbox: false } as T;
    };
    await fetchPaymentMethods(get);
    const second = await fetchPaymentMethods(get);
    expect(calls).toBe(1);
    expect(second.card).toBe(true);
    expect(cachedPaymentMethods().card).toBe(true);
  });
});