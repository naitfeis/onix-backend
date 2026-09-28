/**
 * Withdraw step-up flow helpers — pure so they are testable without DOM.
 *
 * Backend contract: MfaChallengeStatus (safe-deal-platform/src/mfa/mfa.types.ts).
 * Polling must stop on every terminal status, and only CONFIRMED unlocks the
 * retry. CONSUMED means the retry already succeeded elsewhere (second tab).
 */
import { isMfaTerminalStatus, mfaCanRetryWithdraw, type MfaChallengeStatus } from '../api/contracts';

export type MfaStatusGetter = (challengeId: string) => Promise<{ status: string }>;

export type MfaPollOptions = {
  /** Stop after this many ms even without a terminal status. */
  timeoutMs?: number;
  intervalMs?: number;
  signal?: AbortSignal;
};

export type MfaPollResult =
  | { status: MfaChallengeStatus; canRetry: boolean; timedOut: false }
  | { status: MfaChallengeStatus | null; canRetry: false; timedOut: true };

/**
 * Poll GET /api/v2/auth/mfa/status until a terminal status, abort, or timeout.
 * Transient fetch failures are ignored (polling continues) — the timeout is
 * the only backstop.
 */
export async function pollMfaStatus(
  challengeId: string,
  get: MfaStatusGetter,
  options: MfaPollOptions = {},
): Promise<MfaPollResult> {
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  const intervalMs = options.intervalMs ?? 2_500;
  const started = Date.now();
  let lastStatus: MfaChallengeStatus | null = null;

  while (!options.signal?.aborted) {
    if (Date.now() - started >= timeoutMs) {
      return { status: lastStatus, canRetry: false, timedOut: true };
    }
    try {
      const row = await get(challengeId);
      const status = row?.status as MfaChallengeStatus | undefined;
      if (status) {
        lastStatus = status;
        if (isMfaTerminalStatus(status)) {
          return { status, canRetry: mfaCanRetryWithdraw(status), timedOut: false };
        }
      }
    } catch {
      /* keep polling — network blip is not a terminal state */
    }
    await delay(intervalMs, options.signal);
  }
  return { status: lastStatus, canRetry: false, timedOut: true };
}

/** Human label for the raw status shown in the step-up modal. */
export function mfaStatusLabel(status: MfaChallengeStatus | null): string {
  switch (status) {
    case 'PENDING': return 'Ожидает подтверждения в Telegram';
    case 'CONFIRMED': return 'Подтверждено — можно повторить вывод';
    case 'CONSUMED': return 'Подтверждение уже использовано';
    case 'CANCELED': return 'Отклонено';
    case 'EXPIRED': return 'Срок подтверждения истёк';
    case 'FAILED': return 'Ошибка подтверждения';
    default: return 'Ожидание…';
  }
}

/** Copy shown in the step-up modal, without leaking raw enum values. */
export function mfaModalHint(status: MfaChallengeStatus | null): string {
  if (status === 'CONFIRMED') {
    return 'Подтверждение получено — нажмите «Повторить вывод».';
  }
  if (status === 'CONSUMED') {
    return 'Этот вывод уже подтверждён. Закройте окно и проверьте историю баланса.';
  }
  if (status === 'EXPIRED') {
    return 'Срок подтверждения истёк. Закройте окно и отправьте вывод заново.';
  }
  if (status === 'CANCELED') {
    return 'Подтверждение отклонено. Вывод не выполнен.';
  }
  if (status === 'FAILED') {
    return 'Не удалось подтвердить вывод. Попробуйте ещё раз.';
  }
  return 'Для этого вывода нужно подтверждение в Telegram. Откройте бота и нажмите «Подтвердить».';
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(); return; }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}