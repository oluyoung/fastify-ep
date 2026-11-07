import type { Migration } from './types.js';

/**
 * 0.6.0 to 0.6.1. Both contents below are frozen copies, not read from the templates, so this
 * migration keeps working after the templates move on.
 */

const SECURITY_PLUGIN = 'src/infrastructure/http/security.plugin.ts';

/** The Production preset's security plugin as 0.6.0 generated it. */
export const SECURITY_PLUGIN_0_6_0 = `import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';

export default fp(async (fastify: FastifyInstance) => {
  await fastify.register(helmet);

  // No origin is allowed until CORS_ORIGIN is set (comma-separated list of origins, or \`*\`).
  const origins = fastify.config.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  await fastify.register(cors, {
    origin: origins.includes('*') ? true : origins.length > 0 ? origins : false,
  });

  // Counts per client IP in memory, so each instance keeps its own totals. Behind a proxy, set
  // \`trustProxy\` on Fastify so the IP is the client's, and use a shared store for multiple instances.
  await fastify.register(rateLimit, {
    max: fastify.config.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    // Orchestrator probes must never be throttled.
    allowList: (request) => request.url.startsWith('/health'),
  });
});
`;

/** The same file as 0.6.1 generates it: rate limit rejections go through the project's AppError. */
export const SECURITY_PLUGIN_0_6_1 = `import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors/app-error.js';

export default fp(async (fastify: FastifyInstance) => {
  await fastify.register(helmet);

  // No origin is allowed until CORS_ORIGIN is set (comma-separated list of origins, or \`*\`).
  const origins = fastify.config.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  await fastify.register(cors, {
    origin: origins.includes('*') ? true : origins.length > 0 ? origins : false,
  });

  // Counts per client IP in memory, so each instance keeps its own totals. Behind a proxy, set
  // \`trustProxy\` on Fastify so the IP is the client's, and use a shared store for multiple instances.
  await fastify.register(rateLimit, {
    max: fastify.config.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    // Orchestrator probes must never be throttled.
    allowList: (request) => request.url.startsWith('/health'),
    // Throw an AppError so the project's error handler answers with its usual error shape.
    errorResponseBuilder: (_request, context) =>
      new AppError(
        'RATE_LIMITED',
        \`Too many requests, retry in \${context.after}\`,
        context.statusCode,
      ),
  });
});
`;

export const migration0_6_0To0_6_1: Migration = {
  id: '0.6.0-to-0.6.1',
  from: '0.6.0',
  to: '0.6.1',
  plan: ({ manifest }) => [
    ...(manifest.architecture.preset === 'production'
      ? [
          {
            // The whole file is the anchor, so the patch applies completely or not at all.
            kind: 'patch' as const,
            path: SECURITY_PLUGIN,
            anchor: SECURITY_PLUGIN_0_6_0,
            replacement: SECURITY_PLUGIN_0_6_1,
          },
        ]
      : []),
    {
      kind: 'json-key',
      path: 'package.json',
      keyPath: ['devDependencies', 'vitest'],
      from: '^2.0.5',
      to: '^4.1.0',
    },
  ],
};
