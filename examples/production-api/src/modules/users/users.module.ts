import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { registerUsersRoutes } from './users.controller.js';
import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

declare module 'fastify' {
  interface FastifyInstance {
    usersRepository: UsersRepository;
    usersService: UsersService;
  }
}

async function registerDependencies(fastify: FastifyInstance): Promise<void> {
  fastify.decorate('usersRepository', new UsersRepository({ db: fastify.db }));
  fastify.decorate(
    'usersService',
    new UsersService({ usersRepository: fastify.usersRepository }),
  );
}

export default fp(async (fastify) => {
  await registerDependencies(fastify);
  await registerUsersRoutes(fastify);
});
