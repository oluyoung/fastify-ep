import type { FastifyInstance } from 'fastify';

export type ShutdownSignal = 'SIGTERM' | 'SIGINT';

export interface ShutdownOptions {
  signals?: ShutdownSignal[];
  /** Force-exit with code 1 if closing takes longer than this. */
  timeoutMs?: number;
  /** Overridable for tests; defaults to `process.exit`. */
  exit?: (code: number) => void;
  /** Overridable for tests; defaults to the real `process`. */
  proc?: SignalSource;
}

export interface SignalSource {
  on(signal: ShutdownSignal, listener: () => void): unknown;
  removeListener(signal: ShutdownSignal, listener: () => void): unknown;
}

/**
 * SIGTERM/SIGINT -> stop accepting work -> fastify.close() (runs preClose/onClose hooks,
 * so registered resources close) -> exit. Returns a function that removes the listeners.
 */
export function registerShutdownHandlers(
  fastify: FastifyInstance,
  {
    signals = ['SIGTERM', 'SIGINT'],
    timeoutMs = 10_000,
    exit = (code) => process.exit(code),
    proc = process,
  }: ShutdownOptions = {},
): () => void {
  let shuttingDown = false;

  const shutdown = (signal: ShutdownSignal): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    fastify.log.info({ signal }, 'shutdown signal received, closing');

    const timer = setTimeout(() => {
      fastify.log.error({ timeoutMs }, 'shutdown timed out, forcing exit');
      exit(1);
    }, timeoutMs);
    timer.unref();

    fastify.close().then(
      () => {
        clearTimeout(timer);
        exit(0);
      },
      (err: unknown) => {
        clearTimeout(timer);
        fastify.log.error(err, 'error while closing');
        exit(1);
      },
    );
  };

  const listeners = signals.map((signal) => {
    const listener = () => shutdown(signal);
    proc.on(signal, listener);
    return [signal, listener] as const;
  });

  return () => {
    for (const [signal, listener] of listeners) proc.removeListener(signal, listener);
  };
}
