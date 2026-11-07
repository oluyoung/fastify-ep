import { describe, expect, it, vi } from 'vitest';

// Run path building as Windows would, on any OS: manifest keys must still be `/`-separated.
vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:path')>();
  return { ...actual, join: actual.win32.join, default: { ...actual, join: actual.win32.join } };
});

const { schemaAppend } = await import('./generate-resource.js');

describe('schema append paths', () => {
  const vars = { moduleName: 'users', tableName: 'users', EntityName: 'User' };

  it.each(['drizzle', 'prisma'] as const)('%s path is a /-separated manifest key', (database) => {
    const path = schemaAppend(database, vars)?.path;
    expect(path).toBeDefined();
    expect(path).not.toContain('\\');
  });
});
