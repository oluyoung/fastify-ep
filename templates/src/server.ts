import { buildApp } from './app.js';

async function main() {
  const fastify = await buildApp();

  try {
    await fastify.listen({ port: fastify.config.PORT, host: fastify.config.HOST });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
