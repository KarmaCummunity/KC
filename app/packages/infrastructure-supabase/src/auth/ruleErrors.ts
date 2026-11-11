// Turning the stable refusals of baseline RPCs into the application's own errors.
//
// `unwrapCall` already separates three outcomes: a missing object (`BackendUnavailableError`,
// left for the screen's degrade rule), a stable refusal (`BackendRuleError` with a snake_case
// reason) and anything else. An adapter only has to say what each reason means in its module.

import { BackendRuleError } from '@kc/domain';

/**
 * Runs `call`. A `BackendRuleError` is passed to `toError` with its reason; when that returns an
 * error it is thrown instead. Every other failure — including `BackendUnavailableError` — passes
 * through unchanged, so an unexpected error never turns into a quiet success.
 */
export async function mapRuleErrors<T>(
  call: () => Promise<T>,
  toError: (reason: string, error: BackendRuleError) => Error | null,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof BackendRuleError) throw toError(error.reason, error) ?? error;
    throw error;
  }
}
