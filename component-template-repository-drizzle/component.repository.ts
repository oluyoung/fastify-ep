import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { {{model}} } from '../../infrastructure/database/schema.js';

export type {{Name}}Row = typeof {{model}}.$inferSelect;

/** Reads the existing `{{model}}` table. Add the queries this module needs. */
export class {{Name}}Repository {
  private readonly db: FastifyInstance['db'];

  constructor({ db }: { db: FastifyInstance['db'] }) {
    this.db = db;
  }

  async findAll(): Promise<{{Name}}Row[]> {
    return this.db.select().from({{model}});
  }

  async findById(id: string): Promise<{{Name}}Row | undefined> {
    const [row] = await this.db.select().from({{model}}).where(eq({{model}}.id, id));
    return row;
  }
}
