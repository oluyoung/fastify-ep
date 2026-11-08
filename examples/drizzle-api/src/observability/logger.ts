export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Credentials that must never reach the logs, even if a handler logs request headers
 * (`request.log.info({ headers: request.headers })`). Fastify's own request log omits headers.
 */
export const REDACTED_PATHS = [
  'headers.authorization',
  'headers.cookie',
  'headers["set-cookie"]',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

/**
 * Pino options for Fastify. The level comes from `LOG_LEVEL` (default `info`); an unknown value falls
 * back to `info` here and is rejected by the env schema once the app starts.
 */
export function loggerOptions(env: NodeJS.ProcessEnv = process.env) {
  const requested = env.LOG_LEVEL;
  const level: LogLevel = LOG_LEVELS.includes(requested as LogLevel)
    ? (requested as LogLevel)
    : 'info';
  return { level, redact: { paths: REDACTED_PATHS, censor: '[Redacted]' } };
}
