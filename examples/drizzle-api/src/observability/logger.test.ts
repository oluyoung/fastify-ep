import Fastify from 'fastify';
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
