export type CoordinationBackend = 'memory' | 'redis';

export interface CoordinationConfig {
  backend: CoordinationBackend;
  redisUrl?: string;
  instanceId: string;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveCoordinationConfig(env: NodeJS.ProcessEnv = process.env): CoordinationConfig {
  const requested = env.COORDINATION_BACKEND?.trim().toLowerCase() || 'auto';
  if (!['auto', 'memory', 'redis'].includes(requested)) {
    throw new Error('COORDINATION_BACKEND must be auto, memory, or redis.');
  }

  const redisUrl = env.REDIS_URL?.trim();
  const concurrency = positiveInt(env.WEB_CONCURRENCY, 1);
  const production = env.NODE_ENV === 'production';
  const scaleOut = concurrency > 1 || env.SCALE_OUT === 'true';

  if (requested === 'redis' && !redisUrl) {
    throw new Error('COORDINATION_BACKEND=redis requires REDIS_URL.');
  }
  if (requested === 'memory' && (production || scaleOut)) {
    throw new Error(
      'The memory coordination adapter is limited to development/test on one instance; configure REDIS_URL.',
    );
  }
  if (!redisUrl && (production || scaleOut)) {
    throw new Error(
      'Redis coordination is required in production or scale-out mode. Set REDIS_URL and COORDINATION_BACKEND=redis.',
    );
  }

  return {
    backend: requested === 'redis' || (requested === 'auto' && Boolean(redisUrl)) ? 'redis' : 'memory',
    redisUrl,
    instanceId: env.RENDER_INSTANCE_ID?.trim()
      || env.INSTANCE_ID?.trim()
      || `${process.pid}-${Math.random().toString(36).slice(2, 10)}`,
  };
}
