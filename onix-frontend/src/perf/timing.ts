/**
 * Lightweight production timing — navigation + API latency.
 * No PII; samples stay in-memory / console for ops.
 */

export type TimingSample = {
  name: string;
  durationMs: number;
  at: number;
  detail?: string;
};

const samples: TimingSample[] = [];
const MAX_SAMPLES = 80;

function push(sample: TimingSample): void {
  samples.push(sample);
  if (samples.length > MAX_SAMPLES) samples.shift();
  if (import.meta.env.PROD) {
    // One-line ops signal; avoid noisy objects in Telegram WebView consoles.
    console.info(`[onix-timing] ${sample.name}=${Math.round(sample.durationMs)}ms${sample.detail ? ` ${sample.detail}` : ''}`);
  }
}

/** Capture Navigation Timing once after first paint. */
export function captureNavigationTiming(): void {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (!nav) return;
    push({ name: 'ttfb', durationMs: nav.responseStart - nav.requestStart, at: Date.now() });
    push({ name: 'dom-interactive', durationMs: nav.domInteractive - nav.startTime, at: Date.now() });
    push({
      name: 'load',
      durationMs: nav.loadEventEnd > 0 ? nav.loadEventEnd - nav.startTime : performance.now(),
      at: Date.now(),
    });
  } catch {
    /* WebView may omit PerformanceNavigationTiming. */
  }
}

/** Wrap an API call and record duration. */
export async function timedApi<T>(name: string, run: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    const result = await run();
    push({ name: `api:${name}`, durationMs: performance.now() - started, at: Date.now(), detail: 'ok' });
    return result;
  } catch (error) {
    push({
      name: `api:${name}`,
      durationMs: performance.now() - started,
      at: Date.now(),
      detail: error instanceof Error ? error.name : 'error',
    });
    throw error;
  }
}

export function getTimingSamples(): readonly TimingSample[] {
  return samples;
}

/** Mark Mini App / shell ready for ops comparison (<2s goal). */
export function markAppReady(label = 'app-ready'): void {
  push({ name: label, durationMs: performance.now(), at: Date.now() });
}
