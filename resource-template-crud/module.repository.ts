import { randomUUID } from 'node:crypto';
import type {
  Create{{EntityName}}Body,
  {{EntityName}},
  Update{{EntityName}}Body,
} from './{{moduleName}}.schema.js';

// In-memory storage: swap this class for a database-backed one when you need persistence.
export class {{ModuleName}}Repository {
  private readonly items = new Map<string, {{EntityName}}>();

  async findAll(): Promise<{{EntityName}}[]> {
    return [...this.items.values()];
  }

  async findById(id: string): Promise<{{EntityName}} | undefined> {
    return this.items.get(id);
  }

  async create(data: Create{{EntityName}}Body): Promise<{{EntityName}}> {
    const item = { id: randomUUID(), ...data };
    this.items.set(item.id, item);
    return item;
  }

  async update(id: string, data: Update{{EntityName}}Body): Promise<{{EntityName}} | undefined> {
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
