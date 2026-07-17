import { describe, expect, it, beforeEach } from 'vitest';
import { modalStackSize, popModal, pushModal, resetModalStackForTests } from '../design-system/modalStack';

describe('profile-modal-close / modal stack', () => {
  beforeEach(() => {
    resetModalStackForTests();
  });

  it('stacks lot under profile and pops top first', () => {
    const lot = pushModal(() => undefined);
    const profile = pushModal(() => undefined);
    expect(lot.depth).toBe(0);
    expect(profile.depth).toBe(1);
    expect(modalStackSize()).toBe(2);

    // Esc/Back closes top layer only — pop profile, lot remains.
    popModal(profile.id);
    expect(modalStackSize()).toBe(1);
    popModal(lot.id);
    expect(modalStackSize()).toBe(0);
  });

  it('push/pop restores empty stack', () => {
    const a = pushModal(() => undefined);
    const b = pushModal(() => undefined);
    expect(modalStackSize()).toBe(2);
    popModal(b.id);
    popModal(a.id);
    expect(modalStackSize()).toBe(0);
  });
});
