import { Type, type Static } from '@sinclair/typebox';

export const {{camelName}}Schema = Type.Object({
  id: Type.String(),
});

export type {{Name}} = Static<typeof {{camelName}}Schema>;
