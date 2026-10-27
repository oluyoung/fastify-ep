import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';

describe('GET /{{moduleName}}', () => {
  it('returns 200 with a schema-valid body', async () => {
    const app = await buildApp();

    const response = await app.inject({ method: 'GET', url: '/{{moduleName}}' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: '{{moduleName}} is up', count: 0 });

    await app.close();
  });
});
