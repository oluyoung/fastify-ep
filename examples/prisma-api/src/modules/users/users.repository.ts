import type { FastifyInstance } from 'fastify';
import type {
  CreateUserBody,
  User,
  UpdateUserBody,
} from './users.schema.js';

export class UsersRepository {
  private readonly db: FastifyInstance['db'];

  constructor({ db }: { db: FastifyInstance['db'] }) {
    this.db = db;
  }

  async findAll(): Promise<User[]> {
    return this.db.user.findMany();
  }

  async findById(id: string): Promise<User | undefined> {
    return (await this.db.user.findUnique({ where: { id } })) ?? undefined;
  }

  async create(data: CreateUserBody): Promise<User> {
    return this.db.user.create({ data });
  }

  async update(id: string, data: UpdateUserBody): Promise<User | undefined> {
    const { count } = await this.db.user.updateMany({ where: { id }, data });
    return count > 0 ? this.findById(id) : undefined;
  }

  async delete(id: string): Promise<boolean> {
    const { count } = await this.db.user.deleteMany({ where: { id } });
    return count > 0;
  }
}
