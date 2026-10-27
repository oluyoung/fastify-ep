import type { FastifyInstance } from 'fastify';
import { {{camelModuleName}}ResponseSchema } from './{{moduleName}}.schema.js';

export async function register{{ModuleName}}Routes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/{{moduleName}}',
    {
      schema: {
        response: {
          200: {{camelModuleName}}ResponseSchema,
        },
      },
    },
    async () => fastify.{{camelModuleName}}Service.getStatus(),
  );
}
