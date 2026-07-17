/** Ops debug probes — off in production unless explicitly enabled. */
export function debugEndpointsEnabled(): boolean {
  if (process.env.ENABLE_DEBUG_ENDPOINTS === 'true') return true;
  return process.env.NODE_ENV !== 'production';
}
