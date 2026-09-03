/**
 * Single modal stack for Esc / Telegram BackButton / body lock.
 * Only the top entry receives close gestures — prevents nested-modal freezes.
 */

type StackEntry = {
  id: number;
  close: () => void;
  lockBody: boolean;
};

type TelegramBackButton = {
  show: () => void;
  hide: () => void;
  onClick: (cb: () => void) => void;
  offClick: (cb: () => void) => void;
};

const stack: StackEntry[] = [];
let nextId = 1;
let keyBound = false;
let backBound = false;
let savedOverflow = '';

function telegramBackButton(): TelegramBackButton | null {
  try {
    const wa = (window as unknown as { Telegram?: { WebApp?: { BackButton?: TelegramBackButton } } }).Telegram?.WebApp;
    return wa?.BackButton ?? null;
  } catch {
    return null;
  }
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  if (stack.length === 0) return;
  event.preventDefault();
  event.stopPropagation();
  stack[stack.length - 1]?.close();
}

function onBackClick() {
  stack[stack.length - 1]?.close();
}

function syncChrome() {
  if (typeof document === 'undefined') return;
  const open = stack.length > 0;
  const lockBody = stack.some((entry) => entry.lockBody);
  document.body.classList.toggle('modal-open', lockBody);
  if (open) {
    if (!keyBound) {
      window.addEventListener('keydown', onKeyDown, true);
      keyBound = true;
    }
    if (lockBody && document.body.style.overflow !== 'hidden') {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    if (!lockBody && document.body.style.overflow === 'hidden' && savedOverflow !== undefined) {
      document.body.style.overflow = savedOverflow;
      savedOverflow = '';
    }
  } else {
    if (keyBound) {
      window.removeEventListener('keydown', onKeyDown, true);
      keyBound = false;
    }
    document.body.style.overflow = savedOverflow;
    savedOverflow = '';
  }

  const back = telegramBackButton();
  if (!back) return;
  if (open) {
    if (!backBound) {
      back.onClick(onBackClick);
      backBound = true;
    }
    back.show();
  } else if (backBound) {
    back.offClick(onBackClick);
    back.hide();
    backBound = false;
  }
}

/** @returns modal id + depth (0-based) for z-index */
export function pushModal(
  close: () => void,
  options?: { lockBody?: boolean },
): { id: number; depth: number } {
  const id = nextId++;
  stack.push({ id, close, lockBody: options?.lockBody !== false });
  syncChrome();
  return { id, depth: stack.length - 1 };
}

export function popModal(id: number): void {
  const index = stack.findIndex((entry) => entry.id === id);
  if (index < 0) return;
  stack.splice(index, 1);
  syncChrome();
}

export function modalStackSize(): number {
  return stack.length;
}

/** Test helper — reset between unit tests. */
export function resetModalStackForTests(): void {
  stack.length = 0;
  if (typeof window !== 'undefined' && keyBound) {
    window.removeEventListener('keydown', onKeyDown, true);
  }
  keyBound = false;
  backBound = false;
  if (typeof document !== 'undefined') {
    document.body.classList.remove('modal-open');
    document.body.style.overflow = '';
  }
  savedOverflow = '';
  nextId = 1;
}
