import type { HealthResponse, ReadinessResponse } from './health.schema.js';

/** Returns true (or resolves true) when the dependency can serve traffic. */
export type ReadinessCheck = () => boolean | Promise<boolean>;

export class HealthService {
  private readonly readinessChecks = new Map<string, ReadinessCheck>();
  private shuttingDown = false;

  /** Liveness: the process is running and able to answer. */
  getStatus(): HealthResponse {
    return {
      status: 'ok',
      uptime: process.uptime(),
    };
  }

  registerReadinessCheck(name: string, check: ReadinessCheck): void {
    this.readinessChecks.set(name, check);
  }

  /** Once set, readiness reports unavailable so traffic drains before the server closes. */
  markShuttingDown(): void {
    this.shuttingDown = true;
  }

  /** Readiness: every registered check passes. A throwing check counts as down. */
  async getReadiness(): Promise<ReadinessResponse> {
    if (this.shuttingDown) {
      return { status: 'unavailable', checks: { shutdown: 'down' } };
    }
    const checks: ReadinessResponse['checks'] = {};
    for (const [name, check] of this.readinessChecks) {
      try {
        checks[name] = (await check()) ? 'up' : 'down';
      } catch {
        checks[name] = 'down';
      }
    }
    const ready = Object.values(checks).every((state) => state === 'up');
    return { status: ready ? 'ready' : 'unavailable', checks };
  }
}
