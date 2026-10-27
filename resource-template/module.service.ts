import type { {{ModuleName}}Repository } from './{{moduleName}}.repository.js';
import type { {{ModuleName}}Response } from './{{moduleName}}.schema.js';

export class {{ModuleName}}Service {
  private readonly repository: {{ModuleName}}Repository;

  constructor({ {{camelModuleName}}Repository }: { {{camelModuleName}}Repository: {{ModuleName}}Repository }) {
    this.repository = {{camelModuleName}}Repository;
  }

  async getStatus(): Promise<{{ModuleName}}Response> {
    const items = await this.repository.findAll();
    return { message: '{{moduleName}} is up', count: items.length };
  }
}
