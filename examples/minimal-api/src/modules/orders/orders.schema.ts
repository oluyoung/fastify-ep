import { Type, type Static } from '@sinclair/typebox';

export const ordersResponseSchema = Type.Object({
  message: Type.String(),
});

export type OrdersResponse = Static<typeof ordersResponseSchema>;
