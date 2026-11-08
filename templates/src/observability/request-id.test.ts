import Fastify from 'fastify';
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
