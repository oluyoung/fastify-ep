import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../generated/prisma/client.js';
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
 * These tests only read, so they do not know your model's required fields. Add tests that create
 * rows for the queries you write.
 */
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
// The client connects on first query, so it costs nothing when the suite is skipped.
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: testDatabaseUrl ?? 'postgres://postgres@127.0.0.1:1/unused',
    connectionTimeoutMillis: 2000,
  }),
});

async function databaseIsReady(): Promise<boolean> {
  if (!testDatabaseUrl) return false;
  try {
    await prisma.{{delegate}}.count();
    return true;
  } catch {
    return false;
  }
}

const ready = await databaseIsReady();

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!ready)('{{Name}}Repository (database)', () => {
  const repository = new {{Name}}Repository({ db: prisma });

  it('lists rows', async () => {
    expect(Array.isArray(await repository.findAll())).toBe(true);
  });

  it('finds nothing for an unknown id', async () => {
    expect(await repository.findById(randomUUID())).toBeUndefined();
  });
});
