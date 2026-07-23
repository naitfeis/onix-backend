/**
 * Bootstrap phase timing — production console summary for RU / WebView ops.
 * Format:
 *   [bootstrap]
 *   telegram=xx ms
 *   refresh=xx ms
 *   me=xx ms
 *   products=xx ms
 *   ...
 */

const phases = new Map<string, number>();
let bootStarted = 0;
let summaryPrinted = false;
let bootAttempt = 0;
let bootId = '';

export function bootstrapStart(): void {
  bootAttempt += 1;
  bootStarted = performance.now();
  bootId = `${bootAttempt}-${Math.round(bootStarted)}`;
  phases.clear();
  summaryPrinted = false;
  // eslint-disable-next-line no-console
  console.info(`[bootstrap] START #${bootAttempt} id=${bootId}`);
}

export function getBootstrapAttempt(): number {
  return bootAttempt;
}

export function getBootstrapId(): string {
  return bootId;
}

export async function bootstrapPhase<T>(name: string, run: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    return await run();
  } finally {
    phases.set(name, performance.now() - started);
  }
}

export function bootstrapPhaseSync(name: string, run: () => void): void {
  const started = performance.now();
  try {
    run();
  } finally {
    phases.set(name, performance.now() - started);
  }
}

export function markBootstrapPhase(name: string, durationMs: number): void {
  phases.set(name, durationMs);
}

/** First paint / market-critical path done (not waiting for orders/chats). */
export function printBootstrapSummary(label = 'settled'): void {
  if (summaryPrinted) return;
  summaryPrinted = true;
  const total = performance.now() - bootStarted;
  phases.set('bootstrap', total);
  const lines = [
    `[bootstrap] settled #${bootAttempt} id=${bootId}`,
    ...['telegram', 'products-public', 'session-check', 'cookie-check', 'refresh', 'profile-load', 'auth-session', 'me', 'products', 'orders', 'chats', 'profile', 'marketplace', 'bootstrap']
      .filter((key) => phases.has(key))
      .map((key) => `${key}=${Math.round(phases.get(key)!)} ms`),
    `${label}=${Math.round(total)} ms`,
  ];
  console.info(lines.join('\n'));
}

export function getBootstrapPhases(): ReadonlyMap<string, number> {
  return phases;
}
