/**
 * Fetch timeout + retry for transient network / gateway failures.
 * Never retries 401/403 (auth must fail fast).
 * Never retries our own AbortController timeout — that caused "refresh 201 after ~8s"
 * (first attempt hung until timeout, second succeeded).
 */

/** Bound hung sockets; keep under UX pain without double-waiting on retry. */
export const DEFAULT_FETCH_TIMEOUT_MS = 12_000;
/** Retry only fast network failures (reset), not full-timeout aborts. */
export const MAX_NETWORK_RETRIES = 1;

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
  const { timeoutMs: _t, maxRetries: _r, signal: externalSignal, ...rest } = init;

  let attempt = 0;
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
      // Do NOT retry our own timeout — avoids 8s abort + successful retry = "201 after 8s".
      const timedOut = timeout.signal.aborted && !externalSignal?.aborted;
      if (timedOut) throw error;
      if (isRetryableNetworkError(error) && attempt < maxRetries) {
        attempt += 1;
        await delay(backoffMs(attempt));
        continue;
      }
      throw error;
    }
  }
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * attempt, 2500);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
