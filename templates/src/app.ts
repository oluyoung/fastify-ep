import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import envPlugin from './config/env.js';
import { registerErrorHandler } from './errors/error-handler.js';

export async function buildApp() {
  const fastify = Fastify({ logger: true });

  await fastify.register(envPlugin);
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: '{{projectName}}',
        version: '0.1.0',
      },
    },
  });
  await fastify.register(swaggerUi, {
    routePrefix: '/documentation',
  });

  registerErrorHandler(fastify);

  // fastify-ep:register

  return fastify;
}
