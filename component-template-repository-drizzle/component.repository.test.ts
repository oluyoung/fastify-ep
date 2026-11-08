import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import * as schema from '../../infrastructure/database/schema.js';
import { {{Name}}Repository } from './{{name}}.repository.js';

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
 * These tests only read, so they do not know your table's required columns. Add tests that create
 * rows for the queries you write.
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
    await new {{Name}}Repository({ db }).findById(randomUUID());
    return true;
  } catch {
    return false;
  }
}

const ready = await databaseIsReady();

afterAll(async () => {
  await client.end({ timeout: 5 });
});

describe.skipIf(!ready)('{{Name}}Repository (database)', () => {
  const repository = new {{Name}}Repository({ db });

  it('lists rows', async () => {
    expect(Array.isArray(await repository.findAll())).toBe(true);
  });

  it('finds nothing for an unknown id', async () => {
    expect(await repository.findById(randomUUID())).toBeUndefined();
  });
});
