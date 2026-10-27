import Fastify from 'fastify';
import envPlugin from './config/env.js';
import { registerErrorHandler } from './errors/error-handler.js';

export async function buildApp() {
  const fastify = Fastify({ logger: true });

  await fastify.register(envPlugin);
  // fastify-ep:infrastructure

  registerErrorHandler(fastify);

  // fastify-ep:register

  return fastify;
}
