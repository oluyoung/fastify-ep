import type { Migration, MigrationRequest } from './types.js';

/**
 * 0.10.0 to 0.11.0: request ids and a logging convention. Adds \`src/observability/\` (with tests),
 * and patches \`src/app.ts\` and \`src/config/env.ts\` at fixed anchors. The file contents below are
 * frozen copies, not read from the templates, so this migration keeps working after they move on.
 * A file the user edited, or an anchor that no longer matches, is reported for review instead.
 */

const LOGGER = `export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Credentials that must never reach the logs, even if a handler logs request headers
 * (\`request.log.info({ headers: request.headers })\`). Fastify's own request log omits headers.
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
 * Pino options for Fastify. The level comes from \`LOG_LEVEL\` (default \`info\`); an unknown value falls
 * back to \`info\` here and is rejected by the env schema once the app starts.
 */
export function loggerOptions(env: NodeJS.ProcessEnv = process.env) {
  const requested = env.LOG_LEVEL;
  const level: LogLevel = LOG_LEVELS.includes(requested as LogLevel)
    ? (requested as LogLevel)
    : 'info';
  return { level, redact: { paths: REDACTED_PATHS, censor: '[Redacted]' } };
}
`;

const REQUEST_ID = `import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { FastifyInstance } from 'fastify';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Letters, digits, dot, underscore and hyphen, up to 128 characters. Anything else could forge log lines. */
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * The id of a request: the caller's \`x-request-id\` when it is well formed, otherwise a new UUID.
 * Pass this as Fastify's \`genReqId\`.
 */
export function generateRequestId(req: IncomingMessage): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  return typeof incoming === 'string' && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

/** Returns the request id on every response, so a caller can quote it when reporting a problem. */
export function registerRequestId(fastify: FastifyInstance): void {
  fastify.addHook('onSend', async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
  });
}
`;

const LOGGER_TEST = `import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { loggerOptions } from './logger.js';

describe('loggerOptions', () => {
  it('defaults to info', () => {
    expect(loggerOptions({}).level).toBe('info');
  });

  it('uses LOG_LEVEL when it is a known level', () => {
    expect(loggerOptions({ LOG_LEVEL: 'debug' }).level).toBe('debug');
  });

  it('falls back to info for an unknown level', () => {
    expect(loggerOptions({ LOG_LEVEL: 'loud' }).level).toBe('info');
  });

  it('redacts credentials when a handler logs request headers', async () => {
    const lines: string[] = [];
    const app = Fastify({
      logger: {
        ...loggerOptions({}),
        stream: { write: (line: string) => lines.push(line) },
      },
    });
    app.get('/', async (request) => {
      request.log.info(
        { headers: { authorization: 'Bearer secret-token', cookie: 'sid=secret-cookie' } },
        'handled',
      );
      return { ok: true };
    });
    await app.ready();
    await app.inject({ method: 'GET', url: '/' });

    const output = lines.join('');
    expect(output).toContain('handled');
    expect(output).not.toContain('secret-token');
    expect(output).not.toContain('secret-cookie');
    expect(output).toContain('[Redacted]');
  });
});
`;

const REQUEST_ID_TEST = `import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { AppError } from '../errors/app-error.js';
import { registerErrorHandler } from '../errors/error-handler.js';
import { loggerOptions } from './logger.js';
import { generateRequestId, registerRequestId } from './request-id.js';

async function build() {
  const lines: string[] = [];
  const app = Fastify({
    logger: { ...loggerOptions({}), stream: { write: (line: string) => lines.push(line) } },
    genReqId: generateRequestId,
  });
  (app as unknown as { config: { NODE_ENV: string } }).config = { NODE_ENV: 'test' };
  registerRequestId(app);
  registerErrorHandler(app);
  app.get('/ok', async () => ({ ok: true }));
  app.get('/boom', async () => {
    throw new AppError('BOOM', 'Boom', 409);
  });
  await app.ready();
  return { app, lines };
}

describe('request ids', () => {
  it('generates a UUID and returns it as a header', async () => {
    const { app } = await build();
    const response = await app.inject({ method: 'GET', url: '/ok' });
    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('keeps a well-formed id sent by the caller', async () => {
    const { app } = await build();
    const response = await app.inject({
      method: 'GET',
      url: '/ok',
      headers: { 'x-request-id': 'trace-abc.123_DEF' },
    });
    expect(response.headers['x-request-id']).toBe('trace-abc.123_DEF');
  });

  it.each(['has space', 'semi;colon', 'a'.repeat(129)])(
    'replaces a malformed id (%s)',
    async (bad) => {
      const { app } = await build();
      const response = await app.inject({
        method: 'GET',
        url: '/ok',
        headers: { 'x-request-id': bad },
      });
      expect(response.headers['x-request-id']).not.toBe(bad);
      expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    },
  );

  it('uses the same id in the error body, the response header and the logs', async () => {
    const { app, lines } = await build();
    const response = await app.inject({
      method: 'GET',
      url: '/boom',
      headers: { 'x-request-id': 'req-from-caller' },
    });

    const body = response.json() as { error: { requestId: string } };
    expect(response.statusCode).toBe(409);
    expect(body.error.requestId).toBe('req-from-caller');
    expect(response.headers['x-request-id']).toBe('req-from-caller');
    const logged = lines.map((line) => JSON.parse(line) as { reqId?: string });
    expect(logged.some((entry) => entry.reqId === 'req-from-caller')).toBe(true);
    expect(
      logged.every((entry) => entry.reqId === undefined || entry.reqId === 'req-from-caller'),
    ).toBe(true);
  });
});
`;

const FILES: Record<string, string> = {
  'src/observability/logger.ts': LOGGER,
  'src/observability/request-id.ts': REQUEST_ID,
  'src/observability/logger.test.ts': LOGGER_TEST,
  'src/observability/request-id.test.ts': REQUEST_ID_TEST,
};

const IMPORT_ANCHOR = "import { registerErrorHandler } from './errors/error-handler.js';\n";
const FASTIFY_ANCHOR = 'Fastify({ logger: true })';
const ENV_PLUGIN_ANCHOR = '  await fastify.register(envPlugin);\n';
const SCHEMA_ANCHOR = "    SHUTDOWN_TIMEOUT_MS: { type: 'number', default: 10000 },\n";
const TYPE_ANCHOR = '      SHUTDOWN_TIMEOUT_MS: number;\n';

export const migration0_10_0To0_11_0: Migration = {
  id: '0.10.0-to-0.11.0',
  from: '0.10.0',
  to: '0.11.0',
  plan: () => {
    const requests: MigrationRequest[] = Object.entries(FILES).map(([path, content]) => ({
      kind: 'write',
      path,
      content,
    }));
    requests.push(
      {
        kind: 'patch',
        path: 'src/app.ts',
        anchor: IMPORT_ANCHOR,
        replacement: `${IMPORT_ANCHOR}import { loggerOptions } from './observability/logger.js';\nimport { generateRequestId, registerRequestId } from './observability/request-id.js';\n`,
      },
      {
        kind: 'patch',
        path: 'src/app.ts',
        anchor: FASTIFY_ANCHOR,
        replacement: 'Fastify({ logger: loggerOptions(), genReqId: generateRequestId })',
      },
      {
        kind: 'patch',
        path: 'src/app.ts',
        anchor: ENV_PLUGIN_ANCHOR,
        replacement: `${ENV_PLUGIN_ANCHOR}  fastify.log.level = fastify.config.LOG_LEVEL;\n  registerRequestId(fastify);\n`,
      },
      {
        kind: 'patch',
        path: 'src/config/env.ts',
        anchor: SCHEMA_ANCHOR,
        replacement: `    LOG_LEVEL: {\n      type: 'string',\n      enum: ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'],\n      default: 'info',\n    },\n${SCHEMA_ANCHOR}`,
      },
      {
        kind: 'patch',
        path: 'src/config/env.ts',
        anchor: TYPE_ANCHOR,
        replacement: `      LOG_LEVEL: string;\n${TYPE_ANCHOR}`,
      },
    );
    return requests;
  },
};
