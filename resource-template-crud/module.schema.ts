import { Type, type Static } from '@sinclair/typebox';

export const {{camelEntityName}}Schema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String({ minLength: 1 }),
});

export type {{EntityName}} = Static<typeof {{camelEntityName}}Schema>;

export const {{camelModuleName}}ListSchema = Type.Array({{camelEntityName}}Schema);

export const create{{EntityName}}BodySchema = Type.Object({
  name: Type.String({ minLength: 1 }),
});

export type Create{{EntityName}}Body = Static<typeof create{{EntityName}}BodySchema>;

export const update{{EntityName}}BodySchema = Type.Partial(create{{EntityName}}BodySchema);

export type Update{{EntityName}}Body = Static<typeof update{{EntityName}}BodySchema>;

export const {{camelEntityName}}ParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
});

export type {{EntityName}}Params = Static<typeof {{camelEntityName}}ParamsSchema>;
