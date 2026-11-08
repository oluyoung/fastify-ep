import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import * as schema from '../../infrastructure/database/schema.js';
import { UsersRepository } from './users.repository.js';
import { usersTable } from './users.table.js';

/*
 * Runs against a real Postgres, and only when TEST_DATABASE_URL is set, reachable and migrated;
 * otherwise every test here is skipped. It never reads DATABASE_URL, so it cannot touch your
 * development data. To run it:
 *
 *   docker compose exec db createdb -U postgres app_test
 *   export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/app_test
 *   DATABASE_URL=$TEST_DATABASE_URL npm run db:migrate
 *   npm test
 *
 * The tests only touch rows they create, and delete them afterwards.
 */
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
// postgres.js connects on first query, so this client costs nothing when the suite is skipped.
const client = postgres(testDatabaseUrl ?? 'postgres://postgres@127.0.0.1:1/unused', {
  connect_timeout: 2,
  max: 10,
});
const db = drizzle(client, { schema });

async function databaseIsReady(): Promise<boolean> {
  if (!testDatabaseUrl) return false;
  try {
    await db.select().from(usersTable).limit(1);
    return true;
  } catch {
    return false;
  }
}

const ready = await databaseIsReady();

afterAll(async () => {
  await client.end({ timeout: 5 });
});

describe.skipIf(!ready)('UsersRepository (database)', () => {
  const repository = new UsersRepository({ db });
  const createdIds: string[] = [];

  async function create(name: string) {
    const row = await repository.create({ name });
    createdIds.push(row.id);
    return row;
  }

  afterAll(async () => {
    await Promise.all(createdIds.map((id) => repository.delete(id)));
  });

  it('creates, reads, updates and deletes a user', async () => {
    const created = await create('first');
    expect(created).toEqual({ id: expect.any(String), name: 'first' });
    expect(await repository.findById(created.id)).toEqual(created);
    expect(await repository.findAll()).toContainEqual(created);

    expect(await repository.update(created.id, { name: 'renamed' })).toEqual({
      id: created.id,
      name: 'renamed',
    });
    expect(await repository.update(created.id, {})).toEqual({ id: created.id, name: 'renamed' });

    expect(await repository.delete(created.id)).toBe(true);
    expect(await repository.findById(created.id)).toBeUndefined();
  });

  it('reports a user that does not exist', async () => {
    const missing = randomUUID();
    expect(await repository.findById(missing)).toBeUndefined();
    expect(await repository.update(missing, { name: 'x' })).toBeUndefined();
    expect(await repository.delete(missing)).toBe(false);
  });

  it('rejects a row that violates a constraint', async () => {
    // `name` is NOT NULL; the cast skips the type check so the database is what rejects it.
    await expect(repository.create({ name: null } as unknown as { name: string })).rejects.toThrow();
  });

  it('keeps concurrent creates apart', async () => {
    const rows = await Promise.all(Array.from({ length: 10 }, (_, i) => create(`concurrent-${i}`)));

    expect(new Set(rows.map((row) => row.id)).size).toBe(10);
    for (const row of rows) expect(await repository.findById(row.id)).toEqual(row);
  });

  it('applies concurrent updates to the same row without losing it', async () => {
    const row = await create('start');

    const results = await Promise.all([
      repository.update(row.id, { name: 'a' }),
      repository.update(row.id, { name: 'b' }),
    ]);

    expect(results.every((result) => result?.id === row.id)).toBe(true);
    expect(['a', 'b']).toContain((await repository.findById(row.id))?.name);
  });

  it('deletes a row once when deletes race', async () => {
    const row = await create('doomed');

    const results = await Promise.all([repository.delete(row.id), repository.delete(row.id)]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await repository.findById(row.id)).toBeUndefined();
  });
});
