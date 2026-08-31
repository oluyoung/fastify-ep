import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { register{{ModuleName}}Routes } from './{{moduleName}}.controller.js';
import { {{ModuleName}}Service } from './{{moduleName}}.service.js';

declare module 'fastify' {
  interface FastifyInstance {
    {{camelModuleName}}Service: {{ModuleName}}Service;
  }
}

async function registerDependencies(fastify: FastifyInstance): Promise<void> {
  fastify.decorate('{{camelModuleName}}Service', new {{ModuleName}}Service());
}

export default fp(async (fastify) => {
  await registerDependencies(fastify);
  await register{{ModuleName}}Routes(fastify);
});
