import type { FastifyError, FastifyInstance } from 'fastify';
import { AppError } from './app-error.js';

export function registerErrorHandler(fastify: FastifyInstance): void {
  fastify.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    request.log.error(error);

    if (error instanceof AppError) {
      reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, requestId: request.id },
      });
      return;
    }

    if (error.validation) {
      reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: error.message, requestId: request.id },
      });
      return;
    }

    const message =
      fastify.config.NODE_ENV === 'production' ? 'Internal Server Error' : error.message;
    reply.status(500).send({
      error: { code: 'INTERNAL_SERVER_ERROR', message, requestId: request.id },
    });
  });

  fastify.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: { code: 'NOT_FOUND', message: 'Route not found', requestId: request.id },
    });
  });
}
