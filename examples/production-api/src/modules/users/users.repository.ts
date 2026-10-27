import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type {
  CreateUserBody,
  User,
  UpdateUserBody,
} from './users.schema.js';
import { usersTable } from './users.table.js';

export class UsersRepository {
  private readonly db: FastifyInstance['db'];

  constructor({ db }: { db: FastifyInstance['db'] }) {
    this.db = db;
  }

  async findAll(): Promise<User[]> {
    return this.db.select().from(usersTable);
  }

  async findById(id: string): Promise<User | undefined> {
    const [row] = await this.db.select().from(usersTable).where(eq(usersTable.id, id));
    return row;
  }

  async create(data: CreateUserBody): Promise<User> {
    const [row] = await this.db.insert(usersTable).values(data).returning();
    return row;
  }

  async update(id: string, data: UpdateUserBody): Promise<User | undefined> {
    if (Object.keys(data).length === 0) return this.findById(id);
    const [row] = await this.db
      .update(usersTable)
      .set(data)
      .where(eq(usersTable.id, id))
      .returning();
    return row;
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.db
      .delete(usersTable)
      .where(eq(usersTable.id, id))
      .returning({ id: usersTable.id });
    return rows.length > 0;
  }
}
