import type { OrdersResponse } from './orders.schema.js';

export class OrdersService {
  getStatus(): OrdersResponse {
    return { message: 'orders is up' };
  }
}
