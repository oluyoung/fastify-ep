import Fastify from 'fastify';
import envPlugin from './config/env.js';
import { registerErrorHandler } from './errors/error-handler.js';
import { loggerOptions } from './observability/logger.js';
import { generateRequestId, registerRequestId } from './observability/request-id.js';

export async function buildApp() {
  const fastify = Fastify({ logger: loggerOptions(), genReqId: generateRequestId });

  await fastify.register(envPlugin);
  fastify.log.level = fastify.config.LOG_LEVEL;
  registerRequestId(fastify);
  // fastify-ep:infrastructure

  registerErrorHandler(fastify);

  // fastify-ep:register

  return fastify;
}
