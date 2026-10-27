import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors/app-error.js';

export default fp(async (fastify: FastifyInstance) => {
  await fastify.register(helmet);

  // No origin is allowed until CORS_ORIGIN is set (comma-separated list of origins, or `*`).
  const origins = fastify.config.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  await fastify.register(cors, {
    origin: origins.includes('*') ? true : origins.length > 0 ? origins : false,
  });

  // Counts per client IP in memory, so each instance keeps its own totals. Behind a proxy, set
  // `trustProxy` on Fastify so the IP is the client's, and use a shared store for multiple instances.
  await fastify.register(rateLimit, {
    max: fastify.config.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    // Orchestrator probes must never be throttled.
    allowList: (request) => request.url.startsWith('/health'),
    // Throw an AppError so the project's error handler answers with its usual error shape.
    errorResponseBuilder: (_request, context) =>
      new AppError(
        'RATE_LIMITED',
        `Too many requests, retry in ${context.after}`,
        context.statusCode,
      ),
  });
});
