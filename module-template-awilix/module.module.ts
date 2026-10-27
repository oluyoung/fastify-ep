import { Lifetime, asClass } from 'awilix';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { register{{ModuleName}}Routes } from './{{moduleName}}.controller.js';
import { {{ModuleName}}Service } from './{{moduleName}}.service.js';

declare module '@fastify/awilix' {
  interface Cradle {
    {{camelModuleName}}Service: {{ModuleName}}Service;
  }
}

async function registerDependencies(fastify: FastifyInstance): Promise<void> {
  fastify.diContainer.register({
    {{camelModuleName}}Service: asClass({{ModuleName}}Service, { lifetime: Lifetime.{{lifetime}} }),
  });
}

export default fp(async (fastify) => {
  await registerDependencies(fastify);
  await register{{ModuleName}}Routes(fastify);
});
