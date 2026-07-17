import { describe, expect, it, beforeEach } from 'vitest';
import { resetModalStackForTests, pushModal, popModal, modalStackSize } from './modalStack';

describe('telegram-cleanup', () => {
  beforeEach(() => {
    resetModalStackForTests();
  });

  it('keeps a single top-of-stack closer (no fan-out)', () => {
    const first = pushModal(() => undefined);
    const second = pushModal(() => undefined);
    expect(first.depth).toBe(0);
    expect(second.depth).toBe(1);
    expect(modalStackSize()).toBe(2);
    popModal(second.id);
    expect(modalStackSize()).toBe(1);
    popModal(first.id);
    expect(modalStackSize()).toBe(0);
  });

  it('reset clears residual stack between sessions', () => {
    pushModal(() => undefined);
    pushModal(() => undefined);
    resetModalStackForTests();
    expect(modalStackSize()).toBe(0);
  });
});
