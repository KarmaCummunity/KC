// ─────────────────────────────────────────────
// Robust network retry policy for React Query
// Prevents retrying 4xx, auth, and RLS errors.
// Applies exponential backoff on retryable network/server failures.
// ─────────────────────────────────────────────

import { isAuthError } from '@kc/application';

export const DEFAULT_MAX_QUERY_RETRIES = 2;

export function isNonRetryableError(error: unknown): boolean {
  if (!error) return false;

  // 1. Auth errors from domain/application layer
  if (isAuthError(error)) {
    // Only retry if it is an explicit network failure within the auth service
    return error.code !== 'network';
  }

  const errObj = typeof error === 'object' ? (error as Record<string, unknown>) : null;
  if (!errObj) return false;

  // 2. HTTP 4xx status codes (e.g. 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 422)
  const status = typeof errObj['status'] === 'number'
    ? errObj['status']
    : typeof errObj['statusCode'] === 'number'
      ? errObj['statusCode']
      : undefined;

  if (status !== undefined && status >= 400 && status < 500) {
    return true;
  }

  // 3. PostgreSQL / PostgREST error codes
  // 42501 = insufficient_privilege (PostgreSQL RLS violation)
  const code = typeof errObj['code'] === 'string' ? errObj['code'] : undefined;
  if (code === '42501') {
    return true;
  }
  if (
    code &&
    (code.startsWith('PGRST1') || code.startsWith('PGRST2') || code.startsWith('PGRST3'))
  ) {
    return true;
  }

  // 4. Message inspection for auth / permission / RLS failures
  const message = typeof errObj['message'] === 'string' ? errObj['message'].toLowerCase() : '';
  if (
    message.includes('row-level security') ||
    message.includes('permission denied') ||
    message.includes('rls') ||
    message.includes('jwt expired') ||
    message.includes('invalid claim') ||
    message.includes('unauthorized') ||
    message.includes('session expired') ||
    message.includes('session_expired') ||
    message.includes('not authenticated')
  ) {
    return true;
  }

  return false;
}

export function shouldRetryQuery(
  failureCount: number,
  error: unknown,
  maxRetries: number = DEFAULT_MAX_QUERY_RETRIES,
): boolean {
  if (failureCount >= maxRetries) {
    return false;
  }

  if (isNonRetryableError(error)) {
    return false;
  }

  return true;
}

export function queryRetryDelay(attemptIndex: number): number {
  return Math.min(1000 * 2 ** attemptIndex, 30_000);
}
