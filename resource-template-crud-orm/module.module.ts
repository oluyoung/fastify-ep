import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { register{{ModuleName}}Routes } from './{{moduleName}}.controller.js';
import { {{ModuleName}}Repository } from './{{moduleName}}.repository.js';
import { {{ModuleName}}Service } from './{{moduleName}}.service.js';

declare module 'fastify' {
  interface FastifyInstance {
    {{camelModuleName}}Repository: {{ModuleName}}Repository;
    {{camelModuleName}}Service: {{ModuleName}}Service;
  }
}

async function registerDependencies(fastify: FastifyInstance): Promise<void> {
  fastify.decorate('{{camelModuleName}}Repository', new {{ModuleName}}Repository({ db: fastify.db }));
  fastify.decorate(
    '{{camelModuleName}}Service',
    new {{ModuleName}}Service({ {{camelModuleName}}Repository: fastify.{{camelModuleName}}Repository }),
  );
}

export default fp(async (fastify) => {
  await registerDependencies(fastify);
  await register{{ModuleName}}Routes(fastify);
});
