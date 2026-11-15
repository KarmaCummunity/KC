import { BackendRuleError } from '@kc/domain';

/** A stable refusal message is snake_case: lowercase words joined by underscores. */
const STABLE_REASON = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/**
 * The stable reason a staff call was refused with, or null when the failure is not a refusal.
 *
 * `unwrapCall` turns a `P0001` message into a `BackendRuleError`, but the moderation module
 * also refuses with SQLSTATE `42501` and a stable message (`forbidden`, `forbidden_grant`,
 * `forbidden_revoke`), which `mapRpcError` leaves as a plain `Error` with the PostgREST error
 * as its cause. This reads both so the adapters map on the message only, never on a SQLSTATE
 * or on localized text. A `42501` whose message is not stable (an RLS refusal such as "new row
 * violates row-level security policy") is a plain `forbidden`.
 */
export function refusalReason(error: unknown): string | null {
  if (error instanceof BackendRuleError) return error.reason;
  if (!(error instanceof Error)) return null;
  const cause = (error as { cause?: { code?: string } }).cause;
  if (cause?.code !== '42501') return null;
  return STABLE_REASON.test(error.message) ? error.message : 'forbidden';
}
