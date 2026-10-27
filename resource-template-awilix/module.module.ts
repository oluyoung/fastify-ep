import { Lifetime, asClass } from 'awilix';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { register{{ModuleName}}Routes } from './{{moduleName}}.controller.js';
import { {{ModuleName}}Repository } from './{{moduleName}}.repository.js';
import { {{ModuleName}}Service } from './{{moduleName}}.service.js';

declare module '@fastify/awilix' {
  interface Cradle {
    {{camelModuleName}}Repository: {{ModuleName}}Repository;
    {{camelModuleName}}Service: {{ModuleName}}Service;
  }
}

async function registerDependencies(fastify: FastifyInstance): Promise<void> {
  fastify.diContainer.register({
    // Singleton always: the repository holds the in-memory state.
    {{camelModuleName}}Repository: asClass({{ModuleName}}Repository, {
      lifetime: Lifetime.SINGLETON,
    }),
    {{camelModuleName}}Service: asClass({{ModuleName}}Service, { lifetime: Lifetime.{{lifetime}} }),
  });
}

export default fp(async (fastify) => {
  await registerDependencies(fastify);
  await register{{ModuleName}}Routes(fastify);
});
