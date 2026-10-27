import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { AppError } from './app-error.js';

describe('error handler', () => {
  it('formats a thrown AppError as the standard envelope', async () => {
    const app = await buildApp();
    app.get('/boom-app-error', async () => {
      throw new AppError('USER_NOT_FOUND', 'User could not be found', 404);
    });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/boom-app-error' });

    expect(response.statusCode).toBe(404);
    const body = response.json() as { error: { code: string; message: string; requestId: string } };
    expect(body.error.code).toBe('USER_NOT_FOUND');
    expect(body.error.message).toBe('User could not be found');
    expect(typeof body.error.requestId).toBe('string');
  });

  it('formats a schema validation failure as a 400 VALIDATION_ERROR', async () => {
    const app = await buildApp();
    app.get(
      '/boom-validation',
      { schema: { querystring: Type.Object({ name: Type.String() }) } },
      async () => ({ ok: true }),
    );
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/boom-validation' });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(typeof body.error.requestId).toBe('string');
  });

  it('formats an unexpected error as a safe 500 without leaking internals', async () => {
    const app = await buildApp();
    app.get('/boom-unexpected', async () => {
      throw new Error('sensitive internal detail');
    });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/boom-unexpected' });

    expect(response.statusCode).toBe(500);
    const body = response.json() as { error: { code: string; message: string; requestId: string } };
    expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(typeof body.error.requestId).toBe('string');
    expect(JSON.stringify(body)).not.toContain('at ');
  });

  it('formats an unknown route as a 404 NOT_FOUND envelope', async () => {
    const app = await buildApp();
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/does-not-exist' });

    expect(response.statusCode).toBe(404);
    const body = response.json() as { error: { code: string; message: string; requestId: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(typeof body.error.requestId).toBe('string');
  });
});
