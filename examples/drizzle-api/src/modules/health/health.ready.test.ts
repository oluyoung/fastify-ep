import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';

// The database plugin registers its own `database` readiness check when the app becomes ready.
// These tests replace it after `ready()` so they pass without a running database.
describe('GET /health/ready', () => {
  it('returns 200 ready when the database check passes', async () => {
    const app = await buildApp();
    await app.ready();
    app.registerReadinessCheck('database', () => true);

    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ready', checks: { database: 'up' } });

    await app.close();
  });

  it('returns 503 unavailable when the database check fails or throws', async () => {
    const app = await buildApp();
    await app.ready();
    app.registerReadinessCheck('cache', () => true);
    app.registerReadinessCheck('database', () => {
      throw new Error('connection refused');
    });

    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'unavailable',
      checks: { cache: 'up', database: 'down' },
    });

    await app.close();
  });
});
