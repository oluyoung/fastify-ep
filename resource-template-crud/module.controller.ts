import type { FastifyInstance } from 'fastify';
import {
  create{{EntityName}}BodySchema,
  type Create{{EntityName}}Body,
  {{camelEntityName}}ParamsSchema,
  {{camelEntityName}}Schema,
  type {{EntityName}}Params,
  {{camelModuleName}}ListSchema,
  update{{EntityName}}BodySchema,
  type Update{{EntityName}}Body,
} from './{{moduleName}}.schema.js';

export async function register{{ModuleName}}Routes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Body: Create{{EntityName}}Body }>(
    '/{{moduleName}}',
    {
      schema: {
        body: create{{EntityName}}BodySchema,
        response: { 201: {{camelEntityName}}Schema },
      },
    },
    async (request, reply) => {
      const item = await fastify.{{camelModuleName}}Service.create(request.body);
      return reply.code(201).send(item);
    },
  );

  fastify.get(
    '/{{moduleName}}',
    { schema: { response: { 200: {{camelModuleName}}ListSchema } } },
    async () => fastify.{{camelModuleName}}Service.list(),
  );

  fastify.get<{ Params: {{EntityName}}Params }>(
    '/{{moduleName}}/:id',
    {
      schema: {
        params: {{camelEntityName}}ParamsSchema,
        response: { 200: {{camelEntityName}}Schema },
      },
    },
    async (request) => fastify.{{camelModuleName}}Service.get(request.params.id),
  );

  fastify.patch<{ Params: {{EntityName}}Params; Body: Update{{EntityName}}Body }>(
    '/{{moduleName}}/:id',
    {
      schema: {
        params: {{camelEntityName}}ParamsSchema,
        body: update{{EntityName}}BodySchema,
        response: { 200: {{camelEntityName}}Schema },
      },
    },
    async (request) => fastify.{{camelModuleName}}Service.update(request.params.id, request.body),
  );

  fastify.delete<{ Params: {{EntityName}}Params }>(
    '/{{moduleName}}/:id',
    { schema: { params: {{camelEntityName}}ParamsSchema } },
    async (request, reply) => {
      await fastify.{{camelModuleName}}Service.delete(request.params.id);
      return reply.code(204).send();
    },
  );
}
