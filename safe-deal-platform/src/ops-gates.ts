/**
 * Scale-out / ops gates — not implemented until needed.
 *
 * Refresh grace (SessionService.rotationGraceCache):
 *   WEB_CONCURRENCY > 1  OR  >1 API instance
 *     → shared refresh grace required (Redis / DB)
 *   Single node (current Render free): in-memory grace is intentional and sufficient.
 *
 * Realtime bus (RealtimeBus / RealtimeHubService):
 *   WEB_CONCURRENCY > 1  OR  >1 API instance
 *     → shared pub/sub required (Redis)
 *   Single node: in-memory EventEmitter is OK for Stage 5.6 slice 1.
 *
 * Backup:
 *   Prefer Neon/Render PITR + `npm run ops:backup-drill -- verify`
 *   on a scratch RESTORE_DATABASE_URL. Do not build in-app backup.
 *
 * PSP webhooks:
 *   Stay MANUAL until Payment Launch Gate (signature, replay, amount-from-DB).
 */
export const SCALE_OUT_GATES = {
  sharedRefreshGraceWhen: 'WEB_CONCURRENCY > 1 or multi-instance API',
  sharedRealtimeBusWhen: 'WEB_CONCURRENCY > 1 or multi-instance API',
} as const;
