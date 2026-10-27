import { Type, type Static } from '@sinclair/typebox';

/** An example shared contract. Replace it with the schemas and types your services share. */
export const {{LibraryName}}Schema = Type.Object({
  id: Type.String(),
  name: Type.String(),
});

export type {{LibraryName}} = Static<typeof {{LibraryName}}Schema>;
