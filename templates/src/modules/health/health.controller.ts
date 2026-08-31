import type { FastifyInstance } from 'fastify';
import { healthResponseSchema } from './health.schema.js';

export async function registerHealthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/health',
    {
      schema: {
        response: {
          200: healthResponseSchema,
        },
      },
    },
    async () => fastify.healthService.getStatus(),
  );
}
