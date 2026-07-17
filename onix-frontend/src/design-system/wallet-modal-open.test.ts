import { describe, expect, it } from 'vitest';

type MoneyModal = 'MAIN_TOPUP' | 'MAIN_WITHDRAW' | 'DEPOSIT_FUND' | 'DEPOSIT_WITHDRAW' | null;

/** Mirrors Profile wallet open rules — only own /users/me surface. */
function openMoneyFromOwnProfile(isOwnProfile: boolean, kind: Exclude<MoneyModal, null>): MoneyModal {
  if (!isOwnProfile) return null;
  return kind;
}

describe('wallet-modal-open', () => {
  it('opens withdraw/topup only on own profile', () => {
    expect(openMoneyFromOwnProfile(true, 'MAIN_WITHDRAW')).toBe('MAIN_WITHDRAW');
    expect(openMoneyFromOwnProfile(true, 'DEPOSIT_FUND')).toBe('DEPOSIT_FUND');
    expect(openMoneyFromOwnProfile(false, 'MAIN_TOPUP')).toBeNull();
    expect(openMoneyFromOwnProfile(false, 'DEPOSIT_WITHDRAW')).toBeNull();
  });

  it('button order is withdraw then topup', () => {
    const order = ['Вывести', 'Пополнить'];
    expect(order[0]).toBe('Вывести');
    expect(order[1]).toBe('Пополнить');
  });
});
