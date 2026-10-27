import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import envPlugin from './config/env.js';
import { registerErrorHandler } from './errors/error-handler.js';

export async function buildApp() {
  const fastify = Fastify({ logger: true });

  await fastify.register(envPlugin);
  await fastify.register((await import('./infrastructure/database/database.plugin.js')).default);
  // fastify-ep:infrastructure
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'prisma-api',
        version: '0.1.0',
      },
    },
  });
  await fastify.register(swaggerUi, {
    routePrefix: '/documentation',
  });

  registerErrorHandler(fastify);

  await fastify.register((await import('./modules/health/health.module.js')).default);
  await fastify.register((await import('./modules/orders/orders.module.js')).default);
  // fastify-ep:register

  return fastify;
}
