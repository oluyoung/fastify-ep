import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';

describe('users CRUD', () => {
  it('creates, reads, updates and deletes a user', async () => {
    const app = await buildApp();

    const created = await app.inject({
      method: 'POST',
      url: '/users',
      payload: { name: 'first' },
    });
    expect(created.statusCode).toBe(201);
    const { id } = created.json() as { id: string };
    expect(created.json()).toEqual({ id, name: 'first' });

    const list = await app.inject({ method: 'GET', url: '/users' });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([{ id, name: 'first' }]);

    const fetched = await app.inject({ method: 'GET', url: `/users/${id}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toEqual({ id, name: 'first' });

    const updated = await app.inject({
      method: 'PATCH',
      url: `/users/${id}`,
      payload: { name: 'renamed' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual({ id, name: 'renamed' });

    const deleted = await app.inject({ method: 'DELETE', url: `/users/${id}` });
    expect(deleted.statusCode).toBe(204);

    const gone = await app.inject({ method: 'GET', url: `/users/${id}` });
    expect(gone.statusCode).toBe(404);

    await app.close();
  });

  it('rejects an invalid body with 400', async () => {
    const app = await buildApp();

    const response = await app.inject({ method: 'POST', url: '/users', payload: {} });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it('returns 404 for an unknown id', async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/users/00000000-0000-4000-8000-000000000000',
    });

    expect(response.statusCode).toBe(404);

    await app.close();
  });
});
