import fastifyEnv from '@fastify/env';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';

const schema = {
  type: 'object',
  required: ['DATABASE_URL'],
  properties: {
    DATABASE_URL: { type: 'string' },
    PORT: { type: 'number', default: 3000 },
    HOST: { type: 'string', default: '0.0.0.0' },
    NODE_ENV: { type: 'string', default: 'development' },
    SHUTDOWN_TIMEOUT_MS: { type: 'number', default: 10000 },
    CORS_ORIGIN: { type: 'string', default: '' },
    RATE_LIMIT_MAX: { type: 'number', default: 100 },
  },
} as const;

declare module 'fastify' {
  interface FastifyInstance {
    config: {
      DATABASE_URL: string;
      PORT: number;
      HOST: string;
      NODE_ENV: string;
      SHUTDOWN_TIMEOUT_MS: number;
      CORS_ORIGIN: string;
      RATE_LIMIT_MAX: number;
    };
  }
}

export default fp(async (fastify: FastifyInstance) => {
  await fastify.register(fastifyEnv, {
    schema,
    dotenv: true,
  });
});
