import type { IncomingMessage } from 'node:http';
import type { DynamicModule, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ApiConfig } from './platform/config/apiConfig';
import { ApiErrorFilter } from './platform/errors/apiError.filter';
import { REQUEST_ID_HEADER, resolveRequestId } from './platform/http/requestId';

/** Prefix of every business route. A breaking API change ships as a new prefix. */
export const API_VERSION_PREFIX = 'v1';

/**
 * Builds the HTTP application without opening a port: `main.ts` listens on
 * it, tests inject requests into it. Everything every route relies on
 * (request ids, the error body, route versioning) is set up here, once.
 */
export async function createApp(rootModule: Type<unknown> | DynamicModule, config: ApiConfig): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    // Structured JSON request logs; silent in tests to keep their output readable.
    logger: config.environment !== 'test',
    genReqId: (request: IncomingMessage) => resolveRequestId(request.headers[REQUEST_ID_HEADER]),
  });
  // Set the header before any handler runs, so error responses carry it too.
  adapter.getInstance().addHook('onRequest', async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
  });

  const app = await NestFactory.create<NestFastifyApplication>(rootModule, adapter, {
    // Fastify's logger is the one log stream; Nest's own logger would add a second format.
    logger: false,
  });
  app.setGlobalPrefix(API_VERSION_PREFIX, { exclude: ['health'] });
  app.useGlobalFilters(new ApiErrorFilter());
  // Close open connections on SIGTERM, which is how the platform stops an instance.
  app.enableShutdownHooks();

  await app.init();
  await adapter.getInstance().ready();
  return app;
}
