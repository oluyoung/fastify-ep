import { drizzle } from 'drizzle-orm/postgres-js';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import postgres from 'postgres';
import * as schema from './schema.js';

export default fp(async (fastify: FastifyInstance) => {
  const client = postgres(fastify.config.DATABASE_URL, { connect_timeout: 2 });
  fastify.decorate('db', drizzle(client, { schema }));

  // onReady: the health module (which owns registerReadinessCheck) is registered after this plugin.
  fastify.addHook('onReady', async () => {
    fastify.registerReadinessCheck('database', async () => {
      await client`select 1`;
      return true;
    });
  });

  fastify.addHook('onClose', async () => {
    await client.end({ timeout: 5 });
  });
});
