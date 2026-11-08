import type { FastifyInstance } from 'fastify';
import type { {{model}} } from '../../generated/prisma/client.js';

/** Reads the existing `{{model}}` model. Add the queries this module needs. */
export class {{Name}}Repository {
  private readonly db: FastifyInstance['db'];

  constructor({ db }: { db: FastifyInstance['db'] }) {
    this.db = db;
  }

  async findAll(): Promise<{{model}}[]> {
    return this.db.{{delegate}}.findMany();
  }

  async findById(id: string): Promise<{{model}} | undefined> {
    return (await this.db.{{delegate}}.findUnique({ where: { id } })) ?? undefined;
  }
}
