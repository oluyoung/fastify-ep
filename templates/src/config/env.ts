import fastifyEnv from '@fastify/env';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';

const schema = {
  type: 'object',
  properties: {
    PORT: { type: 'number', default: 3000 },
    HOST: { type: 'string', default: '0.0.0.0' },
    NODE_ENV: { type: 'string', default: 'development' },
  },
} as const;

declare module 'fastify' {
  interface FastifyInstance {
    config: {
      PORT: number;
      HOST: string;
      NODE_ENV: string;
    };
  }
}

export default fp(async (fastify: FastifyInstance) => {
  await fastify.register(fastifyEnv, {
    schema,
    dotenv: true,
  });
});
