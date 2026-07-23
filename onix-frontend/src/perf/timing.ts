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
  // Production: only slow/fail samples (bootstrap summary covers happy path).
  const failed = Boolean(sample.detail && sample.detail !== 'ok');
  const slow = sample.durationMs >= 500;
  if (import.meta.env.DEV || failed || slow) {
    // eslint-disable-next-line no-console
    console.info(`[onix-timing] ${sample.name}=${Math.round(sample.durationMs)}ms${sample.detail ? ` ${sample.detail}` : ''}`);
  }
}

/** Capture Navigation Timing (call as early as possible from main.tsx). */
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

/** Schedule capture after loadEventEnd is populated (often 0 if read too early). */
export function captureNavigationTimingWhenReady(): void {
  const run = () => captureNavigationTiming();
  if (document.readyState === 'complete') {
    setTimeout(run, 0);
    return;
  }
  window.addEventListener('load', () => setTimeout(run, 0), { once: true });
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

/** Mark shell / bootstrap milestones (ms since navigation start ≈ performance.now()). */
export function markAppReady(label = 'app-ready'): void {
  const sample: TimingSample = { name: label, durationMs: performance.now(), at: Date.now() };
  samples.push(sample);
  if (samples.length > MAX_SAMPLES) samples.shift();
  // Milestones always visible once — complements [bootstrap] summary.
  // eslint-disable-next-line no-console
  console.info(`[onix-timing] ${sample.name}=${Math.round(sample.durationMs)}ms`);
}
