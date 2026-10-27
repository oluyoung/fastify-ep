import { Lifetime, asClass } from 'awilix';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { registerOrdersRoutes } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

declare module '@fastify/awilix' {
  interface Cradle {
    ordersService: OrdersService;
  }
}

async function registerDependencies(fastify: FastifyInstance): Promise<void> {
  fastify.diContainer.register({
    ordersService: asClass(OrdersService, { lifetime: Lifetime.SINGLETON }),
  });
}

export default fp(async (fastify) => {
  await registerDependencies(fastify);
  await registerOrdersRoutes(fastify);
});
