import type { PrismaClient } from '../../generated/prisma/client.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: PrismaClient;
  }
}
