import type { FastifyInstance } from 'fastify';
import { healthResponseSchema, readinessResponseSchema } from './health.schema.js';

export async function registerHealthRoutes(fastify: FastifyInstance): Promise<void> {
  const liveness = async () => fastify.healthService.getStatus();

  fastify.get('/health', { schema: { response: { 200: healthResponseSchema } } }, liveness);
  fastify.get('/health/live', { schema: { response: { 200: healthResponseSchema } } }, liveness);

  fastify.get(
    '/health/ready',
    {
      schema: {
        response: {
          200: readinessResponseSchema,
          503: readinessResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const readiness = await fastify.healthService.getReadiness();
      return reply.status(readiness.status === 'ready' ? 200 : 503).send(readiness);
    },
  );
}
