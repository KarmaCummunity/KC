/**
 * Detects "the backend does not have this object" and turns it into `BackendUnavailableError`.
 *
 * This is the one definition of the degrade rule's trigger (docs/db/app-migration-playbook.md,
 * docs/db/app-migration-map.md § P0). An adapter whose function, table, column, Edge Function
 * or bucket is absent from the deployed database must not leak a Postgres or HTTP error to the
 * screen: it throws `BackendUnavailableError`, and the screen degrades (empty list, "not
 * available yet" message).
 *
 * Exactly these signals count as "missing" (anything else is a real error and stays one):
 *
 * | signal                              | kind       | meaning                                       |
 * | ----------------------------------- | ---------- | --------------------------------------------- |
 * | PostgREST `PGRST202`                | function   | function not in the schema cache              |
 * | Postgres `42883`                    | function   | `undefined_function`                          |
 * | PostgREST `PGRST205`                | relation   | table or view not in the schema cache         |
 * | PostgREST `PGRST200`                | relation   | no relationship for an embedded resource      |
 * | Postgres `42P01`, `3F000`           | relation   | `undefined_table`, `invalid_schema_name`      |
 * | PostgREST `PGRST204`                | column     | column not in the schema cache                |
 * | Postgres `42703`                    | column     | `undefined_column`                            |
 * | Postgres `42501` + "permission denied for function/table/view/schema/sequence"
 * |                                     | by word    | the object exists but is not granted to the caller (a missing grant is a missing capability) |
 * | Edge Function call, HTTP 404        | edge_function | `FunctionsHttpError` with `context.status` 404 |
 * | Storage "Bucket not found"          | bucket     | `StorageApiError`, HTTP 404                   |
 *
 * `42501` is deliberately NOT missing on its own: baseline RPCs raise `42501` with the message
 * `unauthenticated` for a signed-out caller, and RLS refusals ("new row violates row-level
 * security policy") also use it. Only the "permission denied for <object>" wording of a missing
 * grant counts.
 */
import { BackendUnavailableError, type BackendObjectKind } from '@kc/domain';

/** The fields of a PostgREST, Postgres, Functions or Storage error that the detection reads. */
export type BackendErrorLike = {
  readonly code?: string | null;
  readonly message?: string | null;
  readonly name?: string | null;
  readonly status?: number | string | null;
  readonly statusCode?: number | string | null;
  readonly context?: unknown;
};

const KIND_BY_CODE: Readonly<Record<string, BackendObjectKind>> = {
  PGRST202: 'function',
  '42883': 'function',
  PGRST205: 'relation',
  PGRST200: 'relation',
  '42P01': 'relation',
  '3F000': 'relation',
  PGRST204: 'column',
  '42703': 'column',
};

const PERMISSION_DENIED = /^permission denied for (function|table|view|schema|sequence)\b/i;
/** Wording of old PostgREST versions that did not send a `PGRST20x` code. */
const SCHEMA_CACHE_MISS = /could not find the (function|table|relationship|'[^']+' column)\b.*schema cache/i;

function statusOf(error: BackendErrorLike): number | null {
  const raw = error.status ?? error.statusCode ?? (error.context as { status?: unknown } | undefined)?.status;
  const status = typeof raw === 'string' ? Number(raw) : raw;
  return typeof status === 'number' && Number.isFinite(status) ? status : null;
}

function kindFromWord(word: string): BackendObjectKind {
  const lower = word.toLowerCase();
  if (lower === 'function') return 'function';
  return 'relation';
}

function kindFromMessage(message: string): BackendObjectKind | null {
  const denied = PERMISSION_DENIED.exec(message);
  if (denied) return kindFromWord(denied[1] ?? '');
  const miss = SCHEMA_CACHE_MISS.exec(message);
  if (!miss) return null;
  const what = (miss[1] ?? '').toLowerCase();
  if (what === 'function') return 'function';
  return what.endsWith('column') ? 'column' : 'relation';
}

/** What kind of object the error says is missing, or null when it is not a "missing" error. */
export function backendObjectKind(error: BackendErrorLike | null | undefined): BackendObjectKind | null {
  if (!error) return null;
  const message = error.message ?? '';
  if (error.name === 'FunctionsHttpError' && statusOf(error) === 404) return 'edge_function';
  if (error.name === 'StorageApiError' && /bucket not found/i.test(message)) return 'bucket';
  const code = error.code ?? '';
  if (code === '42501') return PERMISSION_DENIED.test(message) ? kindFromMessage(message) : null;
  const byCode = KIND_BY_CODE[code];
  if (byCode) return byCode;
  return code === '' ? kindFromMessage(message) : null;
}

/** True when the backend lacks (or does not grant) the object the call addressed. */
export function isBackendObjectMissing(error: BackendErrorLike | null | undefined): boolean {
  return backendObjectKind(error) !== null;
}

/**
 * `BackendUnavailableError` for `object` (for example `'rpc:feed_page'`, `'table:chats'`,
 * `'fn:translate'`) when `error` is a "missing" error; null otherwise.
 */
export function toBackendUnavailable(
  object: string,
  error: BackendErrorLike | null | undefined,
): BackendUnavailableError | null {
  const kind = backendObjectKind(error);
  return kind === null ? null : new BackendUnavailableError(object, kind, error);
}
