import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { registerHealthRoutes } from './health.controller.js';
import { HealthService } from './health.service.js';

declare module 'fastify' {
  interface FastifyInstance {
    healthService: HealthService;
  }
}

async function registerDependencies(fastify: FastifyInstance): Promise<void> {
  fastify.decorate('healthService', new HealthService());
}

export default fp(async (fastify) => {
  await registerDependencies(fastify);
  await registerHealthRoutes(fastify);
});
