import { Type, type Static } from '@sinclair/typebox';

export const errorResponseSchema = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
  }),
});

export type ErrorResponse = Static<typeof errorResponseSchema>;
