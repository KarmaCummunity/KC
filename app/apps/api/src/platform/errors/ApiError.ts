/**
 * An expected failure with a stable, client-facing code.
 * Modules throw this (or a subclass) instead of a raw `Error`; the error
 * filter turns it into the response, so no handler formats errors itself.
 */
export class ApiError extends Error {
  constructor(
    /** Stable snake_case code clients switch on, e.g. `post_not_found`. */
    readonly code: string,
    readonly httpStatus: number,
    /** For server logs only; never sent to the client. */
    message?: string,
    /** Structured data the client needs to act on the failure; sent as `error.detail`. */
    readonly detail?: Readonly<Record<string, unknown>>,
  ) {
    super(message ?? code);
    this.name = 'ApiError';
  }
}
