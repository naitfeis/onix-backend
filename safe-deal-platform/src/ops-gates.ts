/**
 * Scale-out / ops gates.
 *
 * Refresh grace (SessionService.rotationGraceCache):
 *   WEB_CONCURRENCY > 1  OR  >1 API instance
 *     → Redis coordination is required at startup.
 *   Memory is limited to local development/tests on one process.
 *
 * Realtime bus (RealtimeBus / RealtimeHubService):
 *   WEB_CONCURRENCY > 1  OR  >1 API instance
 *     → Redis pub/sub is required at startup.
 *
 * Backup:
 *   Prefer Neon/Render PITR + `npm run ops:backup-drill -- verify`
 *   on a scratch RESTORE_DATABASE_URL. Do not build in-app backup.
 *
 * PSP webhooks:
 *   Stay MANUAL until Payment Launch Gate (signature, replay, amount-from-DB).
 */
export const SCALE_OUT_GATES = {
  redisRequiredWhen: 'production, WEB_CONCURRENCY > 1, or SCALE_OUT=true',
  memoryAllowedWhen: 'development/test and one API process only',
} as const;
