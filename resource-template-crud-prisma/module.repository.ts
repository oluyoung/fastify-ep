import type { FastifyInstance } from 'fastify';
import type {
  Create{{EntityName}}Body,
  {{EntityName}},
  Update{{EntityName}}Body,
} from './{{moduleName}}.schema.js';

export class {{ModuleName}}Repository {
  private readonly db: FastifyInstance['db'];

  constructor({ db }: { db: FastifyInstance['db'] }) {
    this.db = db;
  }

  async findAll(): Promise<{{EntityName}}[]> {
    return this.db.{{camelEntityName}}.findMany();
  }

  async findById(id: string): Promise<{{EntityName}} | undefined> {
    return (await this.db.{{camelEntityName}}.findUnique({ where: { id } })) ?? undefined;
  }

  async create(data: Create{{EntityName}}Body): Promise<{{EntityName}}> {
    return this.db.{{camelEntityName}}.create({ data });
  }

  async update(id: string, data: Update{{EntityName}}Body): Promise<{{EntityName}} | undefined> {
    const { count } = await this.db.{{camelEntityName}}.updateMany({ where: { id }, data });
    return count > 0 ? this.findById(id) : undefined;
  }

  async delete(id: string): Promise<boolean> {
    const { count } = await this.db.{{camelEntityName}}.deleteMany({ where: { id } });
    return count > 0;
  }
}
