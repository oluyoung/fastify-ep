import Fastify from 'fastify';
import envPlugin from './config/env.js';
import { registerErrorHandler } from './errors/error-handler.js';

export async function buildApp() {
  const fastify = Fastify({ logger: true });

  await fastify.register(envPlugin);
  // fastify-ep:infrastructure

  registerErrorHandler(fastify);

  await fastify.register((await import('./modules/health/health.module.js')).default);
  await fastify.register((await import('./modules/orders/orders.module.js')).default);
  await fastify.register((await import('./modules/users/users.module.js')).default);
  // fastify-ep:register

  return fastify;
}
