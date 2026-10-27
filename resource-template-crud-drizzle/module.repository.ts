import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type {
  Create{{EntityName}}Body,
  {{EntityName}},
  Update{{EntityName}}Body,
} from './{{moduleName}}.schema.js';
import { {{camelModuleName}}Table } from './{{moduleName}}.table.js';

export class {{ModuleName}}Repository {
  private readonly db: FastifyInstance['db'];

  constructor({ db }: { db: FastifyInstance['db'] }) {
    this.db = db;
  }

  async findAll(): Promise<{{EntityName}}[]> {
    return this.db.select().from({{camelModuleName}}Table);
  }

  async findById(id: string): Promise<{{EntityName}} | undefined> {
    const [row] = await this.db.select().from({{camelModuleName}}Table).where(eq({{camelModuleName}}Table.id, id));
    return row;
  }

  async create(data: Create{{EntityName}}Body): Promise<{{EntityName}}> {
    const [row] = await this.db.insert({{camelModuleName}}Table).values(data).returning();
    return row;
  }

  async update(id: string, data: Update{{EntityName}}Body): Promise<{{EntityName}} | undefined> {
    if (Object.keys(data).length === 0) return this.findById(id);
    const [row] = await this.db
      .update({{camelModuleName}}Table)
      .set(data)
      .where(eq({{camelModuleName}}Table.id, id))
      .returning();
    return row;
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.db
      .delete({{camelModuleName}}Table)
      .where(eq({{camelModuleName}}Table.id, id))
      .returning({ id: {{camelModuleName}}Table.id });
    return rows.length > 0;
  }
}
