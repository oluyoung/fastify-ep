import { Type, type Static } from '@sinclair/typebox';

export const healthResponseSchema = Type.Object({
  status: Type.Literal('ok'),
  uptime: Type.Number(),
});

export type HealthResponse = Static<typeof healthResponseSchema>;
