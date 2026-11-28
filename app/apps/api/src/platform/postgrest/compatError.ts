/**
 * A refusal in PostgREST's own vocabulary: the code, message and HTTP status
 * the Supabase adapters already know how to read. Thrown while a request is
 * parsed or planned, before any SQL runs.
 */
export class PostgrestCompatError extends Error {
  constructor(
    /** PostgREST (`PGRST…`) or Postgres (SQLSTATE) error code. */
    readonly code: string,
    readonly httpStatus: number,
    message: string,
    readonly details: string | null = null,
    readonly hint: string | null = null,
  ) {
    super(message);
    this.name = 'PostgrestCompatError';
  }
}

/** The request uses a part of the PostgREST grammar this engine does not implement. */
export function unsupported(what: string): PostgrestCompatError {
  return new PostgrestCompatError('PGRST100', 400, `unsupported by the KC compatibility engine: ${what}`);
}

/** The request is malformed in a way PostgREST itself would reject. */
export function badRequest(message: string): PostgrestCompatError {
  return new PostgrestCompatError('PGRST100', 400, message);
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Quotes a name for use as an SQL identifier. Names come from adapter code,
 * yet they are still checked: nothing but a plain identifier ever reaches SQL
 * text, and every value travels as a bound parameter.
 */
export function quoteIdentifier(name: string): string {
  if (!IDENTIFIER.test(name)) throw badRequest(`"${name}" is not a valid identifier`);
  return `"${name}"`;
}
