import { describe, expect, it } from 'vitest';
import { AppError } from '../../errors/app-error.js';
import type { UsersRepository } from './users.repository.js';
import type { User } from './users.schema.js';
import { UsersService } from './users.service.js';

// The service is tested against an in-memory stand-in so this test needs no database. Cover the
// repository itself with an integration test against a migrated Postgres.
function fakeRepository(): UsersRepository {
  const items = new Map<string, User>();
  let nextId = 0;
  return {
    findAll: async () => [...items.values()],
    findById: async (id: string) => items.get(id),
    create: async (data: { name: string }) => {
      const item = { id: String(++nextId), ...data };
      items.set(item.id, item);
      return item;
    },
    update: async (id: string, data: { name?: string }) => {
      const existing = items.get(id);
      if (!existing) return undefined;
      const updated = { ...existing, ...data };
      items.set(id, updated);
      return updated;
    },
    delete: async (id: string) => items.delete(id),
  } as unknown as UsersRepository;
}

describe('UsersService', () => {
  it('creates, reads, updates and deletes a user', async () => {
    const service = new UsersService({ usersRepository: fakeRepository() });

    const created = await service.create({ name: 'first' });
    expect(await service.list()).toEqual([created]);
    expect(await service.get(created.id)).toEqual(created);
    expect(await service.update(created.id, { name: 'renamed' })).toEqual({
      ...created,
      name: 'renamed',
    });

    await service.delete(created.id);
    expect(await service.list()).toEqual([]);
  });

  it('throws a 404 AppError for an unknown id', async () => {
    const service = new UsersService({ usersRepository: fakeRepository() });

    await expect(service.get('missing')).rejects.toMatchObject({
      constructor: AppError,
      statusCode: 404,
    });
    await expect(service.update('missing', { name: 'x' })).rejects.toBeInstanceOf(AppError);
    await expect(service.delete('missing')).rejects.toBeInstanceOf(AppError);
  });
});
