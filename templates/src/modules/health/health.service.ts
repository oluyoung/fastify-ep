import type { HealthResponse } from './health.schema.js';

export class HealthService {
  getStatus(): HealthResponse {
    return {
      status: 'ok',
      uptime: process.uptime(),
    };
  }
}
