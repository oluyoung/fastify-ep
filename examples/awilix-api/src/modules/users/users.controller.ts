import type { FastifyInstance } from 'fastify';
import {
  createUserBodySchema,
  type CreateUserBody,
  userParamsSchema,
  userSchema,
  type UserParams,
  usersListSchema,
  updateUserBodySchema,
  type UpdateUserBody,
} from './users.schema.js';

export async function registerUsersRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Body: CreateUserBody }>(
    '/users',
    {
      schema: {
        body: createUserBodySchema,
        response: { 201: userSchema },
      },
    },
    async (request, reply) => {
      const item = await request.diScope.resolve('usersService').create(request.body);
      return reply.code(201).send(item);
    },
  );

  fastify.get(
    '/users',
    { schema: { response: { 200: usersListSchema } } },
    async (request) => request.diScope.resolve('usersService').list(),
  );

  fastify.get<{ Params: UserParams }>(
    '/users/:id',
    {
      schema: {
        params: userParamsSchema,
        response: { 200: userSchema },
      },
    },
    async (request) => request.diScope.resolve('usersService').get(request.params.id),
  );

  fastify.patch<{ Params: UserParams; Body: UpdateUserBody }>(
    '/users/:id',
    {
      schema: {
        params: userParamsSchema,
        body: updateUserBodySchema,
        response: { 200: userSchema },
      },
    },
    async (request) => request.diScope.resolve('usersService').update(request.params.id, request.body),
  );

  fastify.delete<{ Params: UserParams }>(
    '/users/:id',
    { schema: { params: userParamsSchema } },
    async (request, reply) => {
      await request.diScope.resolve('usersService').delete(request.params.id);
      return reply.code(204).send();
    },
  );
}
