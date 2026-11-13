// Reports auth events that end or break a session to Sentry. The auth flow swallows most of
// these on purpose (fail-closed, best-effort), so without an explicit report a user who is
// signed out unexpectedly leaves no trace. Payloads carry a reason and non-identifying
// context only: never a user id, email or token.
import { getSentryIfInit } from './sentry';
import { isReportableError } from './reportHandledError';
import { toError } from './globalErrorHandlers';

/** Why the session ended or the auth step failed; becomes a searchable Sentry tag. */
export type AuthEventReason =
  | 'restore_session_expired'
  | 'restore_gate_denied'
  | 'restore_failed'
  | 'session_ended_unexpectedly'
  | 'gate_reverify'
  | 'gate_blocked'
  | 'gate_check_failed'
  | 'sign_out_failed';

/** Short, non-identifying context (account status, auth event name, ...). */
export type AuthEventDetail = Readonly<Record<string, string | number | boolean | null | undefined>>;

let intentionalSignOut = false;

/**
 * Marks a sign-out the app started itself (settings, account gate), so the matching
 * `SIGNED_OUT` event from the auth client is not reported as unexpected.
 */
export function markIntentionalSignOut(active: boolean): void {
  intentionalSignOut = active;
}

/** True while an app-initiated sign-out is in progress. */
export function isIntentionalSignOut(): boolean {
  return intentionalSignOut;
}

/**
 * Sends one auth event to Sentry (when initialised). With an `error` it is captured as an
 * exception (network blips are dropped); without one it is a warning message. Never throws,
 * so it is safe inside catch blocks and auth listeners.
 */
export function reportAuthEvent(
  reason: AuthEventReason,
  detail: AuthEventDetail = {},
  error?: unknown,
): void {
  try {
    const sentry = getSentryIfInit();
    if (!sentry) return;
    const context = { level: 'warning' as const, tags: { area: 'auth', auth_reason: reason }, extra: detail };
    if (error === undefined) {
      sentry.captureMessage(`auth: ${reason}`, context);
      return;
    }
    const err = toError(error);
    if (isReportableError(err)) sentry.captureException(err, context);
  } catch {
    /* reporting must never break the auth flow */
  }
}

/**
 * Reports a `SIGNED_OUT` event the app did not start itself (for example a refresh token the
 * server rejected), which is how a member ends up logged out with no explanation.
 */
export function reportUnexpectedSignOut(event: string | undefined): void {
  if (event === 'SIGNED_OUT' && !intentionalSignOut) {
    reportAuthEvent('session_ended_unexpectedly', { auth_event: event });
  }
}
