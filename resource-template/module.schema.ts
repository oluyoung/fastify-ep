import { Type, type Static } from '@sinclair/typebox';

export const {{camelEntityName}}Schema = Type.Object({
  id: Type.String(),
});

export type {{EntityName}} = Static<typeof {{camelEntityName}}Schema>;

export const {{camelModuleName}}ResponseSchema = Type.Object({
  message: Type.String(),
  count: Type.Integer(),
});

export type {{ModuleName}}Response = Static<typeof {{camelModuleName}}ResponseSchema>;
