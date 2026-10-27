import { Type, type Static } from '@sinclair/typebox';

export const userSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String({ minLength: 1 }),
});

export type User = Static<typeof userSchema>;

export const usersListSchema = Type.Array(userSchema);

export const createUserBodySchema = Type.Object({
  name: Type.String({ minLength: 1 }),
});

export type CreateUserBody = Static<typeof createUserBodySchema>;

export const updateUserBodySchema = Type.Partial(createUserBodySchema);

export type UpdateUserBody = Static<typeof updateUserBodySchema>;

export const userParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
});

export type UserParams = Static<typeof userParamsSchema>;
