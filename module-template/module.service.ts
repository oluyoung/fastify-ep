import type { {{ModuleName}}Response } from './{{moduleName}}.schema.js';

export class {{ModuleName}}Service {
  getStatus(): {{ModuleName}}Response {
    return { message: '{{moduleName}} is up' };
  }
}
