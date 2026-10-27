import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { registerOrdersRoutes } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

declare module 'fastify' {
  interface FastifyInstance {
    ordersService: OrdersService;
  }
}

async function registerDependencies(fastify: FastifyInstance): Promise<void> {
  fastify.decorate('ordersService', new OrdersService());
}

export default fp(async (fastify) => {
  await registerDependencies(fastify);
  await registerOrdersRoutes(fastify);
});
