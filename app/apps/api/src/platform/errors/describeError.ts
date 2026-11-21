import { HttpException } from '@nestjs/common';
import { ApiError } from './ApiError';

/** What the client is told about a failure. */
export interface ErrorDescription {
  readonly status: number;
  readonly code: string;
  /** Only an `ApiError` can carry detail: it is written for the client on purpose. */
  readonly detail?: Readonly<Record<string, unknown>>;
}

const INTERNAL_ERROR: ErrorDescription = { status: 500, code: 'internal_error' };

/** Codes for the framework's own HTTP failures (unknown route, bad body, …). */
const HTTP_STATUS_CODES: Readonly<Record<number, string>> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  429: 'too_many_requests',
};

/**
 * Maps anything thrown while handling a request to a status and a code.
 * Only the code leaves the server: messages and stack traces can carry
 * internals, so an unknown failure is always the generic `internal_error`.
 */
export function describeError(exception: unknown): ErrorDescription {
  if (exception instanceof ApiError) {
    return { status: exception.httpStatus, code: exception.code, ...(exception.detail ? { detail: exception.detail } : {}) };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    if (status >= 500) return INTERNAL_ERROR;
    return { status, code: HTTP_STATUS_CODES[status] ?? 'request_error' };
  }
  return INTERNAL_ERROR;
}
