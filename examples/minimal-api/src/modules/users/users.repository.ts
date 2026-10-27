import { randomUUID } from 'node:crypto';
import type {
  CreateUserBody,
  User,
  UpdateUserBody,
} from './users.schema.js';

// In-memory storage: swap this class for a database-backed one when you need persistence.
export class UsersRepository {
  private readonly items = new Map<string, User>();

  async findAll(): Promise<User[]> {
    return [...this.items.values()];
  }

  async findById(id: string): Promise<User | undefined> {
    return this.items.get(id);
  }

  async create(data: CreateUserBody): Promise<User> {
    const item = { id: randomUUID(), ...data };
    this.items.set(item.id, item);
    return item;
  }

  async update(id: string, data: UpdateUserBody): Promise<User | undefined> {
    const existing = this.items.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data };
    this.items.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.items.delete(id);
  }
}
