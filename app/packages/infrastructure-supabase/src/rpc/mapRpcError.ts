/**
 * The shared error mapper of every baseline call (docs/db/app-migration-map.md § 2).
 *
 * A baseline RPC refuses with `P0001` and a stable snake_case message
 * (`raise exception 'post_not_found' using errcode = 'P0001'`); a signed-out caller gets
 * `42501` with the message `unauthenticated`. The application maps on that message, never on a
 * SQLSTATE or on localized text. A "missing object" error becomes `BackendUnavailableError`
 * (see `backendUnavailable.ts`). Everything else is returned unchanged for the caller's own
 * handling, so an unknown failure is still an error and never a silent success.
 */
import { BackendRuleError, type BackendUnavailableError } from '@kc/domain';
import { toBackendUnavailable, type BackendErrorLike } from './backendUnavailable';

/** A stable reason is snake_case: lowercase words joined by underscores, nothing else. */
const STABLE_REASON = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/** The stable reason a baseline RPC refused with, or null when the error is not one of those. */
export function rpcErrorReason(error: BackendErrorLike | null | undefined): string | null {
  if (!error) return null;
  const message = (error.message ?? '').trim();
  const refusal = error.code === 'P0001' || (error.code === '42501' && message === 'unauthenticated');
  return refusal && STABLE_REASON.test(message) ? message : null;
}

/** Maps a failed call on `object` to the error the application should see. */
export function mapRpcError(
  object: string,
  error: BackendErrorLike,
): BackendUnavailableError | BackendRuleError | Error {
  const unavailable = toBackendUnavailable(object, error);
  if (unavailable) return unavailable;
  const reason = rpcErrorReason(error);
  if (reason) return new BackendRuleError(reason, object, error);
  return Object.assign(new Error(error.message ?? 'backend call failed'), { cause: error });
}

/** The `{ data, error }` envelope every supabase-js call resolves with. */
export type CallResult<T> = { readonly data: T; readonly error: BackendErrorLike | null };

/**
 * Returns `data` of a successful call and throws `mapRpcError(...)` for a failed one.
 * Usage in an adapter: `return unwrapCall('rpc:feed_page', await client.rpc('feed_page', args));`
 */
export function unwrapCall<T>(object: string, result: CallResult<T>): T {
  if (result.error) throw mapRpcError(object, result.error);
  return result.data;
}
