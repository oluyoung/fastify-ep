import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { FastifyInstance } from 'fastify';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Letters, digits, dot, underscore and hyphen, up to 128 characters. Anything else could forge log lines. */
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * The id of a request: the caller's `x-request-id` when it is well formed, otherwise a new UUID.
 * Pass this as Fastify's `genReqId`.
 */
export function generateRequestId(req: IncomingMessage): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  return typeof incoming === 'string' && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

/** Returns the request id on every response, so a caller can quote it when reporting a problem. */
export function registerRequestId(fastify: FastifyInstance): void {
  fastify.addHook('onSend', async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
  });
}
