import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';

describe('GET /health/ready', () => {
  it('returns 200 ready when no checks are registered', async () => {
    const app = await buildApp();

    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ready', checks: {} });
  });

  it('returns 503 unavailable when a registered check fails or throws', async () => {
    const app = await buildApp();
    app.registerReadinessCheck('cache', () => true);
    app.registerReadinessCheck('database', () => false);
    app.registerReadinessCheck('queue', () => {
      throw new Error('connection refused');
    });

    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'unavailable',
      checks: { cache: 'up', database: 'down', queue: 'down' },
    });
  });
});
