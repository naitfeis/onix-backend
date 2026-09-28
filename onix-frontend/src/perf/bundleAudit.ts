/**
 * Bundle / script timing for ops (parse vs download vs evaluate).
 * Uses Resource Timing + PerformanceObserver — no PII.
 */

type ScriptSample = {
  name: string;
  transferKb: number;
  encodedKb: number;
  downloadMs: number;
  /** Browser does not expose pure parse separately; duration ≈ responseEnd→loadEvent / script eval window. */
  responseMs: number;
};

const samples: ScriptSample[] = [];

function shortName(url: string): string {
  try {
    const path = new URL(url, location.origin).pathname;
    const base = path.split('/').pop() || path;
    if (base.includes('framework')) return 'framework';
    if (base.includes('Market')) return 'marketplace';
    if (base.includes('Chats')) return 'chat';
    if (base.includes('Profile')) return 'profile';
    if (base.includes('Admin')) return 'admin';
    if (base.includes('AuthGate') || base.includes('telegram')) return 'telegram';
    if (base.includes('OnixBackground')) return 'background';
    if (base.includes('Deals')) return 'deals';
    if (base.includes('ProductForm')) return 'create';
    if (base.includes('shared')) return 'shared';
    if (base.startsWith('index-')) return 'shell';
    return base.replace(/\.[a-f0-9]+\.js$/i, '').replace(/\.js$/i, '') || 'script';
  } catch {
    return 'script';
  }
}

export function captureScriptResourceTiming(): void {
  try {
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    for (const entry of entries) {
      if (entry.initiatorType !== 'script' && !entry.name.includes('/assets/')) continue;
      if (!entry.name.endsWith('.js') && !entry.name.includes('.js')) continue;
      const name = shortName(entry.name);
      if (samples.some((s) => s.name === name && s.encodedKb === Math.round((entry.encodedBodySize || 0) / 1024))) {
        continue;
      }
      samples.push({
        name,
        transferKb: Math.round((entry.transferSize || 0) / 1024),
        encodedKb: Math.round((entry.encodedBodySize || entry.transferSize || 0) / 1024),
        downloadMs: Math.max(0, entry.responseEnd - entry.requestStart),
        responseMs: Math.max(0, entry.duration),
      });
    }
  } catch {
    /* ignore */
  }
}

/** Mark when main module evaluation starts/ends (call from main.tsx). */
export function markMainEval(phase: 'start' | 'end'): void {
  try {
    performance.mark(`onix-main-eval-${phase}`);
    if (phase === 'end') {
      performance.measure('onix-main-eval', 'onix-main-eval-start', 'onix-main-eval-end');
      const m = performance.getEntriesByName('onix-main-eval').pop();
      if (m) {
        console.info(`[bundle] main-eval=${Math.round(m.duration)} ms`);
      }
    }
  } catch {
    /* ignore */
  }
}

/** Log resources slower than threshold — catches hung CDN/fonts next cold start. */
export function captureSlowResources(thresholdMs = 1_000): void {
  try {
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const slow = entries
      .filter((e) => e.duration >= thresholdMs)
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 12);
    for (const entry of slow) {
      let host = entry.name;
      try {
        const u = new URL(entry.name, location.origin);
        host = u.origin === location.origin ? u.pathname : `${u.host}${u.pathname}`;
      } catch {
        /* keep raw */
      }
          console.info(
        `[onix-timing] slow-resource=${Math.round(entry.duration)}ms type=${entry.initiatorType || '?'} ${host}`,
      );
    }
  } catch {
    /* ignore */
  }
}

export function printBundleSummary(label = 'bundle'): void {
  captureScriptResourceTiming();
  captureSlowResources();
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const lines = [
    `[${label}]`,
    ...samples.map(
      (s) => `${s.name}: ${s.encodedKb}kb download=${Math.round(s.downloadMs)}ms`,
    ),
  ];
  if (nav) {
    lines.push(
      `dom-interactive=${Math.round(nav.domInteractive)} ms`,
      `dom-complete=${Math.round(nav.domComplete)} ms`,
      `load=${Math.round(nav.loadEventEnd)} ms`,
    );
  }
  const evalEntry = performance.getEntriesByName('onix-main-eval').pop();
  if (evalEntry) lines.push(`main-eval=${Math.round(evalEntry.duration)} ms`);
  console.info(lines.join('\n'));
}

/** Schedule summary after assets settle. */
export function scheduleBundleAudit(): void {
  const run = () => {
    captureScriptResourceTiming();
    printBundleSummary('bundle');
  };
  if (document.readyState === 'complete') {
    setTimeout(run, 500);
  } else {
    window.addEventListener('load', () => setTimeout(run, 500), { once: true });
  }
}
