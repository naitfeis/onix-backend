/**
 * Fetch timeout + retry for transient network / gateway failures.
 * Tuned for RU website paths (Vercel rewrite → Render): frequent
 * net::ERR_CONNECTION_RESET / Failed to fetch that often succeed on retry.
 * Never retries 401/403 (auth must fail fast).
 * Never retries our own AbortController timeout — that caused "refresh 201 after ~8s"
 * (first attempt hung until timeout, second succeeded).
 */

/** Bound hung sockets (Render CF edge can stall on RU). */
export const DEFAULT_FETCH_TIMEOUT_MS = 6_000;
/**
 * Retry only fast network failures (reset) and 502–504.
 * RU ISPs often reset the first TCP attempt; 3 quick retries recover without VPN.
 */
export const MAX_NETWORK_RETRIES = 3;
/**
 * Extra attempts after our AbortController timeout (idempotent GET catalog).
 * Auth refresh/session keep this at 0 — avoid 8s×N on login.
 */
export const DEFAULT_TIMEOUT_RETRIES = 0;

export function isRetryableHttpStatus(status: number): boolean {
  if (status === 401 || status === 403) return false;
  return status === 502 || status === 503 || status === 504;
}

/** Browser maps connection reset / DNS / TLS failures to TypeError (Failed to fetch). */
export function isRetryableNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof DOMException && error.name === 'NetworkError') return true;
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('failed to fetch')
      || message.includes('networkerror')
      || message.includes('connection reset')
      || message.includes('err_connection_reset')
      || message.includes('load failed')
    );
  }
  return false;
}

function mergeAbortSignals(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      return controller.signal;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }
  return controller.signal;
}

export type ResilientFetchOptions = RequestInit & {
  timeoutMs?: number;
  maxRetries?: number;
  /** Retries after our timeout abort (default 0). Use 1 for public GET on RU. */
  maxTimeoutRetries?: number;
};

/**
 * fetch with AbortController timeout and limited retries for network / 502–504.
 * Caller still parses the Response body.
 */
export async function resilientFetch(
  input: string,
  init: ResilientFetchOptions = {},
): Promise<Response> {
  const timeoutMs = init.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const maxRetries = init.maxRetries ?? MAX_NETWORK_RETRIES;
  const maxTimeoutRetries = init.maxTimeoutRetries ?? DEFAULT_TIMEOUT_RETRIES;
  const { timeoutMs: _t, maxRetries: _r, maxTimeoutRetries: _tr, signal: externalSignal, ...rest } = init;

  let attempt = 0;
  let timeoutAttempts = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    const signal = externalSignal
      ? mergeAbortSignals([externalSignal, timeout.signal])
      : timeout.signal;

    try {
      const response = await fetch(input, { ...rest, signal });
      clearTimeout(timer);

      if (!response.ok && isRetryableHttpStatus(response.status) && attempt < maxRetries) {
        attempt += 1;
        await delay(backoffMs(attempt));
        continue;
      }
      return response;
    } catch (error) {
      clearTimeout(timer);
      if (externalSignal?.aborted) throw error;
      const timedOut = timeout.signal.aborted && !externalSignal?.aborted;
      if (timedOut) {
        if (timeoutAttempts < maxTimeoutRetries) {
          timeoutAttempts += 1;
          await delay(backoffMs(timeoutAttempts));
          continue;
        }
        throw error;
      }
      if (isRetryableNetworkError(error) && attempt < maxRetries) {
        attempt += 1;
        await delay(backoffMs(attempt));
        continue;
      }
      throw error;
    }
  }
}

/** Fast first retry (RU reset), then short backoff; cap so total wait stays usable. */
function backoffMs(attempt: number): number {
  if (attempt <= 1) return 300;
  return Math.min(600 * attempt, 2_000);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
