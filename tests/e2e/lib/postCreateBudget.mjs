/**
 * E2E helpers for the member `post_create` hourly window (#2444).
 *
 * The product limit (`kc_private.rate_limits` → `post_create` = 20 / hour) must not change.
 * The suite publishes most listings as one seeded member; a second or third full run inside
 * the same window spends that quota and every publish fails with a bare `rate_limited`, which
 * looks like a product regression. These helpers name the window and decide whether a full
 * run should even start.
 */

/** Deployed `post_create` max (R-SEC-Listing-Write); drafts count. */
export const POST_CREATE_MAX = 20;

/** How many new posts one clean full suite publishes as user A (world journeys + qa creates). */
export const POSTS_PER_FULL_RUN_AS_USER_A = 9;

/** Human label for the configured window (matches the rate_limits row). */
export const POST_CREATE_WINDOW_LABEL = '1 hour';

/**
 * @param {{ used: number, max?: number, needed?: number, email?: string }} args
 * @returns {{ ok: true, remaining: number } | { ok: false, remaining: number, message: string }}
 */
export function decidePostCreateBudget({
  used,
  max = POST_CREATE_MAX,
  needed = POSTS_PER_FULL_RUN_AS_USER_A,
  email = 'the seeded member',
}) {
  const remaining = Math.max(0, max - used);
  if (remaining >= needed) return { ok: true, remaining };
  return {
    ok: false,
    remaining,
    message: exhaustedBudgetMessage({ email, used, max, remaining, needed }),
  };
}

/**
 * Clear failure when a publish (or the suite preflight) hits `post_create`.
 * @param {{ email: string, used?: number, max?: number, remaining?: number, needed?: number }} args
 */
export function exhaustedBudgetMessage({
  email,
  used,
  max = POST_CREATE_MAX,
  remaining,
  needed = POSTS_PER_FULL_RUN_AS_USER_A,
}) {
  const left =
    remaining !== undefined
      ? remaining
      : used === undefined
        ? undefined
        : Math.max(0, max - used);
  const countBit =
    left === undefined
      ? ''
      : ` About ${used} post(s) already count in the current window (${left} left; a full run needs ~${needed}).`;
  return (
    `E2E post_create budget exhausted for ${email}: a member may create ${max} new posts per ` +
    `${POST_CREATE_WINDOW_LABEL} (drafts included; kc_private.rate_limits action post_create).` +
    countBit +
    ' This is the suite spending the seeded member\'s hourly write window, not a product regression. ' +
    `Wait until the ${POST_CREATE_WINDOW_LABEL} window ends before re-running publish-heavy journeys.`
  );
}

/** True when a thrown Error / REST body is the server's `rate_limited` refusal. */
export function isRateLimitedError(err) {
  const text = typeof err === 'string' ? err : err?.message ?? String(err ?? '');
  return /\brate_limited\b/.test(text);
}
