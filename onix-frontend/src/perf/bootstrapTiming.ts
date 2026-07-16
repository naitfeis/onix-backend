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

export function bootstrapStart(): void {
  bootStarted = performance.now();
  phases.clear();
  summaryPrinted = false;
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
    '[bootstrap]',
    ...['telegram', 'auth-session', 'cookie-check', 'refresh', 'me', 'products', 'orders', 'chats', 'profile', 'marketplace', 'bootstrap']
      .filter((key) => phases.has(key))
      .map((key) => `${key}=${Math.round(phases.get(key)!)} ms`),
    `${label}=${Math.round(total)} ms`,
  ];
  console.info(lines.join('\n'));
}

export function getBootstrapPhases(): ReadonlyMap<string, number> {
  return phases;
}
