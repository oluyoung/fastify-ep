import type { FastifyInstance } from 'fastify';

// Every dependency resolvable from the container is declared here (modules add their own service).
declare module '@fastify/awilix' {
  interface Cradle {
    db: FastifyInstance['db'];
    // fastify-ep:cradle
  }
}
