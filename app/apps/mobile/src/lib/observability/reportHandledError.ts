// Reports errors the app CATCHES (react-query failures, try/catch fallbacks) to
// Sentry. Sentry's own handlers only see uncaught errors, so without this the
// vast majority of real-world failures — which are handled and shown as a toast
// or an empty state — never reach the dashboard.
import { getSentryIfInit } from './sentry';
import { isNonRetryableError } from '../queryRetryPolicy';
import { toError } from './globalErrorHandlers';

/** Where the handled error came from; becomes a searchable Sentry tag. */
export type HandledErrorSource = 'query' | 'mutation' | 'manual';

/**
 * Network failures are expected on mobile (offline, flaky radio) and would
 * drown the free-tier quota, so they are not reported. Matches the messages
 * fetch / supabase-js raise for an unreachable server.
 */
const NETWORK_FAILURE_PATTERN = /network request failed|failed to fetch|network error|load failed|timeout|offline/i;

/** True for errors worth a Sentry event: not a network blip. */
export function isReportableError(error: Error): boolean {
  return !NETWORK_FAILURE_PATTERN.test(error.message);
}

/**
 * Sends a handled error to Sentry (when initialised). Never throws, so it is
 * safe to call from inside a catch block or a react-query cache callback.
 * `key` identifies the failing query / mutation and is attached as context.
 */
export function reportHandledError(
  raw: unknown,
  source: HandledErrorSource,
  key?: readonly unknown[],
): void {
  try {
    const error = toError(raw);
    if (!isReportableError(error)) return;
    getSentryIfInit()?.captureException(error, {
      level: isNonRetryableError(raw) ? 'warning' : 'error',
      tags: { boundary: 'handled', source },
      extra: { key: key ? JSON.stringify(key).slice(0, 200) : undefined },
    });
  } catch {
    /* reporting must never break the caller */
  }
}
