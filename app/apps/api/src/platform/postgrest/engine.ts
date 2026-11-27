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

/**
 * HTTP status for a SQLSTATE. Adapters read the code and message, not the
 * status, so this only has to separate "the caller's request" from "the
 * server's fault" for logs and alerts.
 */
function statusOfSqlState(code: string): number {
  if (code === '42501') return 403;
  if (code === '42883' || code === '42P01') return 404;
  if (code.startsWith('23')) return 409;
  if (code.startsWith('08') || code.startsWith('53') || code.startsWith('57') || code.startsWith('XX')) return 500;
  return 400;
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

function contentRange(plan: Plan, row: ResultRow): Record<string, string> {
  if (plan.kind !== 'read' && plan.kind !== 'rpc') return {};
  const total = plan.count ? (row.total ?? '0') : '*';
  const range = row.row_count === 0 ? '*' : `${plan.offset}-${plan.offset + row.row_count - 1}`;
  return { 'content-range': `${range}/${total}` };
}

/** `Accept: …object+json`: the body must be exactly one row, returned as an object. */
function singularResponse(row: ResultRow, headers: Record<string, string>): CompatResponse {
  if (row.row_count !== 1 || row.body === null) {
    return errorResponse(406, 'PGRST116', 'Cannot coerce the result to a single JSON object', `The result contains ${row.row_count} rows`, null);
  }
  const parsed: unknown = JSON.parse(row.body);
  return { status: 200, headers, body: JSON.stringify(Array.isArray(parsed) ? parsed[0] : parsed) };
}

function successResponse(plan: Plan, row: ResultRow): CompatResponse {
  const headers = { ...JSON_HEADERS, ...contentRange(plan, row) };
  if ('head' in plan && plan.head) return { status: 200, headers, body: null };
  if (plan.singular) return singularResponse(row, headers);
  if (row.body === null) {
    // A scalar function that returned SQL NULL answers JSON `null`; everything
    // else with no body (void function, change without `return=representation`) is empty.
    const scalarNull = plan.kind === 'rpc' && row.row_count === 1;
    return { status: scalarNull ? 200 : plan.kind === 'insert' ? 201 : 204, headers, body: scalarNull ? 'null' : null };
  }
  return { status: plan.kind === 'insert' ? 201 : 200, headers, body: row.body };
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
export async function handleCompatRequest(request: CompatRequest, schema: SchemaCacheSource, run: StatementRunner): Promise<CompatResponse> {
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
      return errorResponse(statusOfSqlState(error.code), error.code, error.message, error.detail ?? null, error.hint ?? null);
    }
    throw error;
  }
}
