import { diContainer, fastifyAwilixPlugin } from '@fastify/awilix';
import { asValue } from 'awilix';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

// The shared container uses Awilix's default PROXY injection mode: constructors receive the cradle
// and destructure what they need, e.g. `constructor({ db }: Cradle) {}`.
export default fp(async (fastify: FastifyInstance) => {
  await fastify.register(fastifyAwilixPlugin, { disposeOnClose: true, disposeOnResponse: true });

  diContainer.register({ db: asValue(fastify.db) });
  // fastify-ep:di-registrations
});
