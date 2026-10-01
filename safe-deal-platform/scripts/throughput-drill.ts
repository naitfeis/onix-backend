/**
 * Throughput + stability drill against REAL Postgres, driving the REAL services.
 *
 * Existing drills cover correctness (fraud lifecycle) and one narrow race
 * (db-concurrency-drill). This one answers the capacity question the product needs
 * before launch: can the chat path hold 100 messages/second and can the money path
 * hold 10 simultaneous deals/second WITHOUT corrupting the ledger or overselling.
 *
 * Scenarios:
 *   A. chat-throughput   - N senders over M pair chats, sustained target msg/s.
 *   B. purchase-race     - 10 concurrent deals/second on ONE lot: exactly `quantity`
 *                          winners, the rest refused, stock never negative.
 *   C. money-invariants  - after everything, the ledger must still reconcile:
 *                          Σ amounts == balance, and every chain link agrees.
 *   D. fraud-watch-race  - an armed marker fires under concurrency: the victim is
 *                          repaid EXACTLY once, never twice.
 *
 * Usage:
 *   $env:THROUGHPUT_DRILL_DATABASE_URL = "postgresql://user@127.0.0.1:55432/drill?sslmode=disable"
 *   npm run ops:throughput-drill
 *   Optional: LOAD_MSG_PER_SEC=100 LOAD_DEALS_PER_SEC=10 LOAD_DURATION_SEC=10 LOAD_POOL_MAX=40
 *
 * Never falls back to DATABASE_URL, and refuses pooler/prod-looking hosts.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { BalanceService } from '../src/economy/wallet/balance.service';
import { ClawbackService } from '../src/economy/wallet/clawback.service';
import { LockService } from '../src/economy/wallet/lock.service';
import { DepositService } from '../src/economy/wallet/deposit.service';
import { EscrowService } from '../src/escrow.module';
import { ChatService } from '../src/engagement.module';
import { FraudWatchService } from '../src/risk/fraud-watch.service';
import { RealtimeBus } from '../src/realtime/realtime-bus.service';
import { SharedCoordinationService } from '../src/coordination/shared-coordination.service';
import { MemoryCoordinationAdapter } from '../src/coordination/memory-coordination.adapter';
import { resolveCoordinationConfig } from '../src/coordination/coordination.config';
import { ensurePairChat } from '../src/chat-pair';
import type { AuthUser } from '../src/common';

const outDir = resolve(process.cwd(), 'ops-drills');
const evidenceDir = resolve(process.cwd(), 'docs/architecture/ops-evidence');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

const MSG_PER_SEC = Number(process.env.LOAD_MSG_PER_SEC ?? 100);
const DEALS_PER_SEC = Number(process.env.LOAD_DEALS_PER_SEC ?? 10);
const DURATION_SEC = Number(process.env.LOAD_DURATION_SEC ?? 10);
const POOL_MAX = Number(process.env.LOAD_POOL_MAX ?? 40);

const LOT_PRICE = 100_000n; // 1000 RUB
const LOT_STOCK = 25;       // fewer units than concurrent buyers, so the race is real

function pickUrl(): string {
  const dedicated = (process.env.THROUGHPUT_DRILL_DATABASE_URL ?? '').trim();
  if (dedicated) return dedicated;
  throw new Error(
    'Set THROUGHPUT_DRILL_DATABASE_URL to a scratch Postgres URL '
    + '(this drill never falls back to DATABASE_URL).',
  );
}

function redact(url: string): { host: string | null; isPooler: boolean; looksProd: boolean } {
  try {
    const u = new URL(url.replace(/^postgresql:/i, 'http:'));
    const host = u.hostname;
    const looksProd = ['onixtg', 'prod', 'production', 'render.com']
      .some((s) => host.toLowerCase().includes(s));
    return { host, isPooler: /-pooler\./i.test(host), looksProd };
  } catch {
    return { host: null, isPooler: false, looksProd: false };
  }
}

type Sample = { ok: boolean; status: string; ms: number };

function summarize(samples: Sample[], seconds: number) {
  const sorted = [...samples].map((s) => s.ms).sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
  const byStatus: Record<string, number> = {};
  for (const s of samples) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
  const ok = samples.filter((s) => s.ok).length;
  return {
    total: samples.length,
    ok,
    failed: samples.length - ok,
    throughputPerSec: Number((samples.length / seconds).toFixed(1)),
    p50Ms: Number(pct(0.5).toFixed(1)),
    p95Ms: Number(pct(0.95).toFixed(1)),
    p99Ms: Number(pct(0.99).toFixed(1)),
    maxMs: Number((sorted[sorted.length - 1] ?? 0).toFixed(1)),
    byStatus,
  };
}

/**
 * Pace `total` operations across `seconds` with an even inter-arrival time, so the
 * measured throughput is the requested rate rather than "as fast as the box allows".
 */
function pacer(total: number, seconds: number, launch: (index: number) => Promise<Sample>) {
  const intervalMs = (seconds * 1000) / total;
  const samples: Sample[] = [];
  const started = performance.now();
  const inflight: Array<Promise<void>> = [];
  return {
    samples,
    async run(): Promise<number> {
      for (let i = 0; i < total; i += 1) {
        const targetAt = started + i * intervalMs;
        const wait = targetAt - performance.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        inflight.push(
          launch(i).then((s) => { samples.push(s); }).catch((error: unknown) => {
            samples.push({
              ok: false,
              status: `unhandled:${error instanceof Error ? error.message.slice(0, 40) : 'error'}`,
              ms: 0,
            });
          }),
        );
      }
      await Promise.all(inflight);
      return (performance.now() - started) / 1000;
    },
  };
}

function userActor(id: bigint): AuthUser {
  return { id, telegramId: null, onixId: 'LD-000000', isAdmin: false, isSupport: false };
}