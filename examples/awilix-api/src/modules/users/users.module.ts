import { Lifetime, asClass } from 'awilix';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { registerUsersRoutes } from './users.controller.js';
import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

declare module '@fastify/awilix' {
  interface Cradle {
    usersRepository: UsersRepository;
    usersService: UsersService;
  }
}

async function registerDependencies(fastify: FastifyInstance): Promise<void> {
  fastify.diContainer.register({
    // Singleton always: the repository holds the in-memory state.
    usersRepository: asClass(UsersRepository, {
      lifetime: Lifetime.SINGLETON,
    }),
    usersService: asClass(UsersService, { lifetime: Lifetime.SINGLETON }),
  });
}

export default fp(async (fastify) => {
  await registerDependencies(fastify);
  await registerUsersRoutes(fastify);
});
