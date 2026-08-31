import { Type, type Static } from '@sinclair/typebox';

export const {{camelModuleName}}ResponseSchema = Type.Object({
  message: Type.String(),
});

export type {{ModuleName}}Response = Static<typeof {{camelModuleName}}ResponseSchema>;
