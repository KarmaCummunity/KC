import type { Provider } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';

/** Logger for events outside a request (connections, shutdown, background work). */
export type AppLogger = FastifyBaseLogger;

/** Injection token of the `AppLogger`. */
export const APP_LOGGER = Symbol('APP_LOGGER');

/**
 * Exposes the HTTP server's logger to providers, so request logs and
 * process-level logs are one stream with one format.
 */
export const appLoggerProvider: Provider = {
  provide: APP_LOGGER,
  inject: [HttpAdapterHost],
  useFactory: (host: HttpAdapterHost): AppLogger => host.httpAdapter.getInstance<FastifyInstance>().log,
};
