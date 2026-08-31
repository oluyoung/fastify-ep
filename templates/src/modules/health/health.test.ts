import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';

describe('GET /health', () => {
  it('returns 200 with a schema-valid body', async () => {
    const app = await buildApp();

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { status: string; uptime: number };
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
  });
});
