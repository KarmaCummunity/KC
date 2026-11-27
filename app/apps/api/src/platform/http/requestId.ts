import { randomUUID } from 'node:crypto';

/** Header that carries the request id in both directions. */
export const REQUEST_ID_HEADER = 'x-request-id';

// Letters, digits, `.`, `_`, `-`; long enough for a UUID or a trace id.
const WELL_FORMED_REQUEST_ID = /^[\w.-]{8,128}$/;

/**
 * Picks the id that tags a request in logs, error bodies and the response.
 * A caller's id is kept only when well-formed: the value is written to logs
 * and echoed in a header, so free text from the network is never accepted.
 */
export function resolveRequestId(headerValue: string | string[] | undefined): string {
  return typeof headerValue === 'string' && WELL_FORMED_REQUEST_ID.test(headerValue) ? headerValue : randomUUID();
}
