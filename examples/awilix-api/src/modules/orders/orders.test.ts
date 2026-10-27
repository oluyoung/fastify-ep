import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';

describe('GET /orders', () => {
  it('returns 200 with a schema-valid body', async () => {
    const app = await buildApp();

    const response = await app.inject({ method: 'GET', url: '/orders' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: 'orders is up' });

    await app.close();
  });
});
