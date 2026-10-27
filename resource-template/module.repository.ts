import type { {{EntityName}} } from './{{moduleName}}.schema.js';

export class {{ModuleName}}Repository {
  private readonly items = new Map<string, {{EntityName}}>();

  async findAll(): Promise<{{EntityName}}[]> {
    return [...this.items.values()];
  }
}
