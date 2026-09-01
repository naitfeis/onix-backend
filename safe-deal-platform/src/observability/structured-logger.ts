import { redactSecrets } from '../safe-error-log';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, string | number | boolean | null | undefined>;

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function minLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw;
  return 'info';
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel()];
}

function redactFields(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = typeof value === 'string' ? redactSecrets(value) : value;
  }
  return out;
}

function serializeError(err: unknown): LogFields {
  if (err instanceof Error) {
    return {
      errName: err.name,
      errMessage: redactSecrets(err.message),
      errStack: err.stack ? redactSecrets(err.stack) : undefined,
    };
  }
  if (typeof err === 'string') return { errMessage: redactSecrets(err) };
  return { errMessage: '[unserializable]' };
}

/**
 * JSON structured logger (12-factor stdout). Secrets are redacted.
 * Nest LoggerAdapter can wrap this; workers and scripts use it directly.
 */
export function slog(
  level: LogLevel,
  message: string,
  fields: LogFields = {},
  err?: unknown,
): void {
  if (!shouldLog(level)) return;
  const payload: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: redactSecrets(message),
    service: process.env.OTEL_SERVICE_NAME ?? process.env.RENDER_SERVICE_NAME ?? 'onix-api',
    env: process.env.NODE_ENV ?? 'development',
    ...redactFields(fields),
  };
  if (err !== undefined) Object.assign(payload, serializeError(err));
  const line = redactSecrets(JSON.stringify(payload));
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const structuredLog = {
  debug: (msg: string, fields?: LogFields) => slog('debug', msg, fields),
  info: (msg: string, fields?: LogFields) => slog('info', msg, fields),
  warn: (msg: string, fields?: LogFields, err?: unknown) => slog('warn', msg, fields, err),
  error: (msg: string, fields?: LogFields, err?: unknown) => slog('error', msg, fields, err),
};
