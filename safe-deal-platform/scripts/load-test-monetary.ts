/**
 * Load test against a running ONIX API.
 *
 * Usage:
 *   LOAD_BASE_URL=https://www.onixtg.shop npm run test:load
 *   LOAD_BASE_URL=http://localhost:3000 LOAD_CONCURRENCY=40 LOAD_DURATION_SEC=30 npm run test:load
 *
 * Default targets are public/health/metrics (no auth). Set LOAD_AUTH_BEARER to include /api/users/me.
 */
import { performance } from 'node:perf_hooks';

const base = (process.env.LOAD_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const concurrency = Number(process.env.LOAD_CONCURRENCY ?? 20);
const durationSec = Number(process.env.LOAD_DURATION_SEC ?? 20);
const bearer = (process.env.LOAD_AUTH_BEARER ?? '').trim();

const paths = [
  '/api/health/live',
  '/api/health/ready',
  '/api/metrics',
];
if (bearer) paths.push('/api/users/me');

type Sample = { ok: boolean; status: number; ms: number; path: string };

async function hit(path: string): Promise<Sample> {
  const started = performance.now();
  try {
    const res = await fetch(`${base}${path}`, {
      headers: bearer && path === '/api/users/me'
        ? { Authorization: `Bearer ${bearer}` }
        : undefined,
      signal: AbortSignal.timeout(12_000),
    });
    return { ok: res.ok, status: res.status, ms: performance.now() - started, path };
  } catch {
    return { ok: false, status: 0, ms: performance.now() - started, path };
  }
}

async function worker(deadline: number, out: Sample[]): Promise<void> {
  let i = 0;
  while (performance.now() < deadline) {
    const path = paths[i % paths.length]!;
    i += 1;
    out.push(await hit(path));
  }
}

async function main(): Promise<void> {
  console.log(JSON.stringify({
    msg: 'load-test start',
    base,
    concurrency,
    durationSec,
    paths,
  }));
  const samples: Sample[] = [];
  const deadline = performance.now() + durationSec * 1000;
  await Promise.all(Array.from({ length: concurrency }, () => worker(deadline, samples)));

  const ok = samples.filter((s) => s.ok).length;
  const err = samples.length - ok;
  const sorted = [...samples].map((s) => s.ms).sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
  const byStatus: Record<string, number> = {};
  for (const s of samples) {
    const k = String(s.status);
    byStatus[k] = (byStatus[k] ?? 0) + 1;
  }

  const report = {
    msg: 'load-test done',
    total: samples.length,
    ok,
    err,
    rps: samples.length / durationSec,
    p50Ms: Number(pct(0.5).toFixed(1)),
    p95Ms: Number(pct(0.95).toFixed(1)),
    p99Ms: Number(pct(0.99).toFixed(1)),
    byStatus,
  };
  console.log(JSON.stringify(report));

  // Soft SLO for health endpoints under load.
  if (err / samples.length > 0.05 || pct(0.95) > 3_000) {
    console.error(JSON.stringify({ msg: 'load-test SLO breach', ...report }));
    process.exitCode = 1;
  }
}

void main();
