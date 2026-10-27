import type { FastifyInstance } from 'fastify';
import { ordersResponseSchema } from './orders.schema.js';

export async function registerOrdersRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/orders',
    {
      schema: {
        response: {
          200: ordersResponseSchema,
        },
      },
    },
    async (request) => request.diScope.resolve('ordersService').getStatus(),
  );
}
