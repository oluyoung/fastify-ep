import { PrismaPg } from '@prisma/adapter-pg';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { PrismaClient } from '../../generated/prisma/client.js';

export default fp(async (fastify: FastifyInstance) => {
  const adapter = new PrismaPg({
    connectionString: fastify.config.DATABASE_URL,
    connectionTimeoutMillis: 2000,
  });
  const prisma = new PrismaClient({ adapter });
  fastify.decorate('db', prisma);

  // onReady: the health module (which owns registerReadinessCheck) is registered after this plugin.
  fastify.addHook('onReady', async () => {
    fastify.registerReadinessCheck('database', async () => {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    });
  });

  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
});
