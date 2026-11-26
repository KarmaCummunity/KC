import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { describeError } from './describeError';

/** Body of every error response. `requestId` lets support find the log line. */
export interface ErrorResponseBody {
  readonly error: { readonly code: string; readonly requestId: string; readonly detail?: Readonly<Record<string, unknown>> };
}

/**
 * The single place where a failure becomes an HTTP response.
 * Registered globally, so every route, including unknown ones, answers with
 * the same body shape.
 */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const { status, code, detail } = describeError(exception);

    // Server faults are logged in full, with the request id the client received.
    if (status >= 500) {
      request.log.error({ err: exception }, 'request failed');
    }

    const body: ErrorResponseBody = { error: { code, requestId: request.id, ...(detail ? { detail } : {}) } };
    void reply.status(status).send(body);
  }
}
