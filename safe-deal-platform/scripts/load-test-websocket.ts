/**
 * Guarded WebSocket load probe. It only authenticates and sends `ping`.
 *
 * Required:
 *   WS_LOAD_TARGET_URL=wss://staging.example/api/realtime
 *   WS_LOAD_ACCESS_TOKEN=<staging access token>
 *   WS_LOAD_CONFIRM=onix-websocket-load-test
 *
 * Optional safe limits:
 *   WS_LOAD_CONNECTIONS=3 WS_LOAD_DURATION_SEC=10 WS_LOAD_PING_INTERVAL_MS=2000
 */
import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';

const CONFIRMATION = 'onix-websocket-load-test';
const targetUrl = required('WS_LOAD_TARGET_URL');
const accessToken = required('WS_LOAD_ACCESS_TOKEN');
const confirmation = required('WS_LOAD_CONFIRM');
if (confirmation !== CONFIRMATION) {
  throw new Error(`WS_LOAD_CONFIRM must equal "${CONFIRMATION}"`);
}

const parsedTarget = new URL(targetUrl);
if (parsedTarget.protocol !== 'ws:' && parsedTarget.protocol !== 'wss:') {
  throw new Error('WS_LOAD_TARGET_URL must use ws:// or wss://');
}

const connections = boundedInteger('WS_LOAD_CONNECTIONS', 3, 1, 25);
const durationSec = boundedInteger('WS_LOAD_DURATION_SEC', 10, 1, 60);
const pingIntervalMs = boundedInteger('WS_LOAD_PING_INTERVAL_MS', 2_000, 500, 30_000);
const origin = process.env.WS_LOAD_ORIGIN?.trim() || httpOrigin(parsedTarget);

type Client = {
  ws: WebSocket;
  pendingPingAt: number | null;
};

async function main(): Promise<void> {
  console.log(JSON.stringify({
    msg: 'websocket load probe start',
    target: redactedTarget(parsedTarget),
    origin,
    connections,
    durationSec,
    pingIntervalMs,
    behavior: 'auth-and-ping-only',
  }));

  const clients: Client[] = [];
  const latencies: number[] = [];
  let pongs = 0;
  let errors = 0;
  let unexpectedCloses = 0;

  try {
    // Authenticate sequentially to avoid bursts against the unauthenticated-IP guard.
    for (let index = 0; index < connections; index += 1) {
      clients.push(await connectClient(index));
    }

    for (const client of clients) {
      client.ws.on('message', (raw) => {
        const message = parseMessage(raw.toString());
        if (message?.type === 'pong' && client.pendingPingAt !== null) {
          latencies.push(performance.now() - client.pendingPingAt);
          client.pendingPingAt = null;
          pongs += 1;
        } else if (message?.type === 'error') {
          errors += 1;
        }
      });
      client.ws.on('close', () => {
        if (performance.now() < deadline) unexpectedCloses += 1;
      });
      client.ws.on('error', () => {
        errors += 1;
      });
    }

    deadline = performance.now() + durationSec * 1_000;
    while (performance.now() < deadline) {
      for (const client of clients) {
        if (client.ws.readyState === WebSocket.OPEN && client.pendingPingAt === null) {
          client.pendingPingAt = performance.now();
          client.ws.send(JSON.stringify({ type: 'ping' }));
        }
      }
      await delay(Math.min(pingIntervalMs, Math.max(1, deadline - performance.now())));
    }
  } finally {
    deadline = 0;
    await Promise.all(clients.map(closeClient));
  }

  const sorted = latencies.sort((a, b) => a - b);
  const report = {
    msg: 'websocket load probe done',
    connectionsOpened: clients.length,
    pongs,
    errors,
    unexpectedCloses,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
  };
  console.log(JSON.stringify(report));

  if (clients.length !== connections || pongs === 0 || errors > 0 || unexpectedCloses > 0) {
    process.exitCode = 1;
  }
}

let deadline = Number.POSITIVE_INFINITY;

function connectClient(index: number): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(targetUrl, { origin, handshakeTimeout: 5_000 });
    const timeout = setTimeout(() => fail(new Error(`client ${index + 1} authentication timed out`)), 8_000);

    const fail = (error: Error): void => {
      clearTimeout(timeout);
      try { ws.close(); } catch { /* ignore */ }
      reject(error);
    };

    ws.once('open', () => {
      ws.send(JSON.stringify({ type: 'auth', accessToken }));
    });
    ws.on('message', (raw) => {
      const message = parseMessage(raw.toString());
      if (message?.type === 'ready') {
        clearTimeout(timeout);
        resolve({ ws, pendingPingAt: null });
      } else if (message?.type === 'error') {
        fail(new Error(`client ${index + 1} rejected: ${String(message.code ?? 'unknown')}`));
      }
    });
    ws.once('error', (error) => fail(error));
    ws.once('close', (code) => fail(new Error(`client ${index + 1} closed during auth (${code})`)));
  });
}

function closeClient(client: Client): Promise<void> {
  return new Promise((resolve) => {
    if (client.ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    const timeout = setTimeout(() => {
      client.ws.terminate();
      resolve();
    }, 1_000);
    client.ws.once('close', () => {
      clearTimeout(timeout);
      resolve();
    });
    client.ws.close(1000, 'load probe complete');
  });
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required; this script never infers a deployment target or token`);
  return value;
}

function boundedInteger(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function parseMessage(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw) as unknown;
    return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function httpOrigin(url: URL): string {
  return `${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}`;
}

function redactedTarget(url: URL): string {
  return `${url.protocol}//${url.host}${url.pathname}`;
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const value = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
  return Number(value.toFixed(1));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify({
    msg: 'websocket load probe failed',
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
});
