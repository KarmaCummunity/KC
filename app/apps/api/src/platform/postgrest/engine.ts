import { PostgrestCompatError } from './compatError';
import { type CompatRequest, type Plan, planRequest } from './requestPlan';
import type { SchemaCache } from './schemaCache';
import { buildStatement, resolveSignature, type ResultRow } from './sqlStatements';
import type { SqlStatement } from './sqlText';

/** Runs one statement as the caller and returns its single result row. */
export type StatementRunner = (statement: SqlStatement) => Promise<ResultRow | undefined>;

/** What the engine answers: an HTTP response in PostgREST's shape. */
export interface CompatResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | null;
}

/** Supplies the schema cache and can reload it after a miss. */
export interface SchemaCacheSource {
  current(): Promise<SchemaCache>;
  /** Reloads at most once per cooldown; returns the freshest cache it has. */
  reload(): Promise<SchemaCache>;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function errorResponse(status: number, code: string, message: string, details: string | null, hint: string | null): CompatResponse {
  return { status, headers: JSON_HEADERS, body: JSON.stringify({ code, details, hint, message }) };
}

/** The fields of a driver error this engine reads. */
interface DatabaseError {
  code: string;
  message: string;
  detail?: string;
  hint?: string;
}

function isDatabaseError(error: unknown): error is DatabaseError {
  const code = (error as { code?: unknown } | null)?.code;
  return error instanceof Error && typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code);
}

/** PostgREST's status for one SQLSTATE, where it differs from its class. */
const STATUS_OF_SQLSTATE: Readonly<Record<string, number>> = {
  '23503': 409, // foreign key violation
  '23505': 409, // unique violation
  '25006': 405, // read-only transaction
  '42883': 404, // undefined function
  '42P01': 404, // undefined table
  '42P17': 500, // infinite recursion in a policy
  '53400': 500, // configuration limit exceeded
  '57P01': 503, // terminated by an administrator
  P0001: 400, // a function's own `raise exception`
};

/** PostgREST's status for a class of SQLSTATEs (the first two characters). Any other class is the caller's request: 400. */
const STATUS_OF_SQLSTATE_CLASS: Readonly<Record<string, number>> = {
  '08': 503, // connection exception
  '09': 500, // triggered action exception
  '0L': 403, // invalid grantor
  '0P': 403, // invalid role specification
  '25': 500, // invalid transaction state
  '28': 403, // invalid authorization specification
  '2D': 500, // invalid transaction termination
  '38': 500, // external routine exception
  '39': 500, // external routine invocation exception
  '3B': 500, // savepoint exception
  '40': 500, // transaction rollback
  '53': 503, // insufficient resources
  '54': 500, // program limit exceeded
  '55': 500, // object not in prerequisite state
  '57': 500, // operator intervention
  '58': 500, // system error
  F0: 500, // configuration file error
  HV: 500, // foreign data wrapper error
  P0: 500, // PL/pgSQL error other than a plain `raise`
  XX: 500, // internal error
};

/** A function may choose its own status by raising SQLSTATE `PT<status>`. */
const CUSTOM_STATUS = /^PT(\d{3})$/;

const INSUFFICIENT_PRIVILEGE = '42501';

/**
 * HTTP status for a SQLSTATE, as PostgREST maps it, so that a client, a log
 * or an alert reads the same status from this server as from the one it
 * replaces (checked request by request by the parity suite).
 * @param isVisitor Whether the request has no signed-in caller: being refused then means "sign in" (401), not "not yours" (403).
 */
function statusOfSqlState(code: string, isVisitor: boolean): number {
  if (code === INSUFFICIENT_PRIVILEGE) return isVisitor ? 401 : 403;
  const custom = CUSTOM_STATUS.exec(code);
  if (custom) return Number(custom[1]);
  return STATUS_OF_SQLSTATE[code] ?? STATUS_OF_SQLSTATE_CLASS[code.slice(0, 2)] ?? 400;
}

/** True when the plan names a relation or function the cache does not know. */
function missesCache(plan: Plan, cache: SchemaCache): boolean {
  return plan.kind === 'rpc' ? !cache.functions.has(plan.name) : !cache.relations.has(plan.relation);
}

function assertKnown(plan: Plan, cache: SchemaCache): void {
  if (plan.kind === 'rpc') {
    resolveSignature(plan.name, Object.keys(plan.args), cache);
  } else if (!cache.relations.has(plan.relation)) {
    throw new PostgrestCompatError('PGRST205', 404, `Could not find the table 'public.${plan.relation}' in the schema cache`);
  }
}

/** The rows an answer covers, as `first-last`, or `*` for none. */
const rowRange = (offset: number, rowCount: number) => (rowCount === 0 ? '*' : `${offset}-${offset + rowCount - 1}`);

/**
 * The `Content-Range` header, as PostgREST sets it: the rows of a page and,
 * when asked, their total. A change reports the rows it touched only for an
 * update; an insert and a delete report none.
 */
function contentRange(plan: Plan, row: ResultRow): Record<string, string> {
  if (plan.kind === 'insert' || plan.kind === 'delete') return { 'content-range': '*/*' };
  if (plan.kind === 'update') return { 'content-range': `${rowRange(0, row.row_count)}/*` };
  const total = plan.count ? (row.total ?? '0') : '*';
  // A function that returns nothing still counts as one result.
  const isVoidCall = plan.kind === 'rpc' && row.body === null && row.row_count === 0;
  return { 'content-range': `${isVoidCall ? '0-0' : rowRange(plan.offset, row.row_count)}/${total}` };
}

/** A row that was created answers 201; every other answer with a body answers 200. */
const statusWithBody = (plan: Plan) => (plan.kind === 'insert' ? 201 : 200);

/** `Accept: …object+json`: the body must be exactly one row, returned as an object. */
function singularResponse(plan: Plan, row: ResultRow, headers: Record<string, string>): CompatResponse {
  if (row.row_count !== 1 || row.body === null) {
    return errorResponse(406, 'PGRST116', 'Cannot coerce the result to a single JSON object', `The result contains ${row.row_count} rows`, null);
  }
  const parsed: unknown = JSON.parse(row.body);
  return { status: statusWithBody(plan), headers, body: JSON.stringify(Array.isArray(parsed) ? parsed[0] : parsed) };
}

function successResponse(plan: Plan, row: ResultRow): CompatResponse {
  const headers = { ...JSON_HEADERS, ...contentRange(plan, row) };
  if ('head' in plan && plan.head) return { status: 200, headers, body: null };
  if (plan.singular) return singularResponse(plan, row, headers);
  if (row.body === null) {
    // A scalar function that returned SQL NULL answers JSON `null`; everything
    // else with no body (void function, change without `return=representation`) is empty.
    const scalarNull = plan.kind === 'rpc' && row.row_count === 1;
    return { status: scalarNull ? 200 : plan.kind === 'insert' ? 201 : 204, headers, body: scalarNull ? 'null' : null };
  }
  return { status: statusWithBody(plan), headers, body: row.body };
}

/**
 * Answers a PostgREST-dialect request with SQL, in process.
 *
 * It exists so the existing Supabase adapters can run on the server
 * unchanged (ADR-010): they keep building requests with the PostgREST
 * client, and this engine executes them through `run`, which is the caller's
 * own database transaction. Grants and row-level security therefore decide
 * what each request may touch, exactly as they do behind PostgREST.
 */
export async function handleCompatRequest(
  request: CompatRequest,
  schema: SchemaCacheSource,
  run: StatementRunner,
  /** `isVisitor`: `run` executes as a signed-out visitor. */
  caller: { readonly isVisitor: boolean } = { isVisitor: false },
): Promise<CompatResponse> {
  try {
    const plan = planRequest(request);
    let cache = await schema.current();
    // A migration may have added the object since the cache was loaded.
    if (missesCache(plan, cache)) cache = await schema.reload();
    assertKnown(plan, cache);
    const row = await run(buildStatement(plan, cache));
    return successResponse(plan, row ?? { body: null, row_count: 0 });
  } catch (error) {
    if (error instanceof PostgrestCompatError) {
      return errorResponse(error.httpStatus, error.code, error.message, error.details, error.hint);
    }
    if (error instanceof SyntaxError) return errorResponse(400, 'PGRST102', error.message, null, null);
    if (isDatabaseError(error)) {
      return errorResponse(statusOfSqlState(error.code, caller.isVisitor), error.code, error.message, error.detail ?? null, error.hint ?? null);
    }
    throw error;
  }
}
