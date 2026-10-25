import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { registerHealthRoutes } from './health.controller.js';
import { HealthService, type ReadinessCheck } from './health.service.js';

declare module 'fastify' {
  interface FastifyInstance {
    healthService: HealthService;
    /** Contribute a named check to `GET /health/ready`. Register it after the health module. */
    registerReadinessCheck(name: string, check: ReadinessCheck): void;
  }
}

async function registerDependencies(fastify: FastifyInstance): Promise<void> {
  const healthService = new HealthService();
  fastify.decorate('healthService', healthService);
  fastify.decorate('registerReadinessCheck', (name: string, check: ReadinessCheck) =>
    healthService.registerReadinessCheck(name, check),
  );
  fastify.addHook('preClose', async () => healthService.markShuttingDown());
}

export default fp(async (fastify) => {
  await registerDependencies(fastify);
  await registerHealthRoutes(fastify);
});
