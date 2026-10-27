import { AppError } from '../../errors/app-error.js';
import type { {{ModuleName}}Repository } from './{{moduleName}}.repository.js';
import type {
  Create{{EntityName}}Body,
  {{EntityName}},
  Update{{EntityName}}Body,
} from './{{moduleName}}.schema.js';

function notFound(): AppError {
  return new AppError('NOT_FOUND', '{{EntityName}} not found', 404);
}

export class {{ModuleName}}Service {
  private readonly repository: {{ModuleName}}Repository;

  constructor({ {{camelModuleName}}Repository }: { {{camelModuleName}}Repository: {{ModuleName}}Repository }) {
    this.repository = {{camelModuleName}}Repository;
  }

  list(): Promise<{{EntityName}}[]> {
    return this.repository.findAll();
  }

  async get(id: string): Promise<{{EntityName}}> {
    const item = await this.repository.findById(id);
    if (!item) throw notFound();
    return item;
  }

  create(data: Create{{EntityName}}Body): Promise<{{EntityName}}> {
    return this.repository.create(data);
  }

  async update(id: string, data: Update{{EntityName}}Body): Promise<{{EntityName}}> {
    const item = await this.repository.update(id, data);
    if (!item) throw notFound();
    return item;
  }

  async delete(id: string): Promise<void> {
    const deleted = await this.repository.delete(id);
    if (!deleted) throw notFound();
  }
}
