import { buildApp } from './app.js';
import { registerShutdownHandlers } from './lifecycle/shutdown.js';

async function main() {
  const fastify = await buildApp();

  registerShutdownHandlers(fastify, { timeoutMs: fastify.config.SHUTDOWN_TIMEOUT_MS });

  try {
    await fastify.listen({ port: fastify.config.PORT, host: fastify.config.HOST });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
