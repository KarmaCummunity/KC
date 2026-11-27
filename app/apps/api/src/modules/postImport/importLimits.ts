// Who may run an extraction right now (FR-IMPORT-008 AC3-AC4): account age,
// the moderation lockout, the per-member rate and the shared daily budget. A
// pure decision over counts the store provides. A refusal is never an error
// for the member: the draft falls back to the manual route with the reason.
//
// Ported from `supabase/functions/_shared/post-extraction/limits.ts`.

export interface LimitConfig {
  /** An account younger than this cannot import. */
  minAccountAgeMs: number;
  perHour: number;
  perDay: number;
  /** Model calls the whole service may make per day; the cache and the manual route stay available. */
  dailyBudget: number;
  /** Moderation lockout (AC4): this many removals of imported posts within the window lock imports. */
  lockoutRemovals: number;
  lockoutWindowMs: number;
  /** How long the lock lasts, counted from the removal that completed the count. */
  lockoutDurationMs: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_LIMITS: LimitConfig = {
  minAccountAgeMs: DAY_MS,
  perHour: 5,
  perDay: 20,
  dailyBudget: 2000,
  lockoutRemovals: 3,
  lockoutWindowMs: 30 * DAY_MS,
  lockoutDurationMs: 14 * DAY_MS,
};

/** How far back the removals that can still lock a member reach: a window, then the lock itself. */
export function lockoutLookbackMs(config: LimitConfig = DEFAULT_LIMITS): number {
  return config.lockoutWindowMs + config.lockoutDurationMs;
}

export type LimitReason = 'account_too_new' | 'import_locked' | 'rate_limited' | 'budget_exhausted';

export interface LimitInputs {
  /** From the verified token; unknown fails closed as too new. */
  accountCreatedAt: Date | null;
  now: Date;
  /** The member's attempts, cache hits and manual routes included. */
  attemptsLastHour: number;
  attemptsLastDay: number;
  /** Model calls made by everyone since the start of the UTC day. */
  providerCallsToday: number;
  /** When moderation removed the member's imported posts, within `lockoutLookbackMs` (any order). */
  moderationRemovals: readonly Date[];
}

/**
 * The end of the member's import lock, or null when none is running (FR-IMPORT-008 AC4). Every
 * removal that completes `lockoutRemovals` within `lockoutWindowMs` starts a lock of
 * `lockoutDurationMs`; the latest such lock is the one that counts.
 */
export function importLockedUntil(removals: readonly Date[], now: Date, config: LimitConfig = DEFAULT_LIMITS): Date | null {
  const times = removals.map((d) => d.getTime()).sort((a, b) => a - b);
  let until: number | null = null;
  for (let i = config.lockoutRemovals - 1; i < times.length; i++) {
    // The removal at i closes a run of `lockoutRemovals` when the first of that run is inside the window.
    const last = times[i] as number;
    const first = times[i - config.lockoutRemovals + 1] as number;
    if (last - first <= config.lockoutWindowMs) {
      until = last + config.lockoutDurationMs;
    }
  }
  return until !== null && until > now.getTime() ? new Date(until) : null;
}

/** The first limit that applies, or null when the extraction may run. */
export function checkLimits(input: LimitInputs, config: LimitConfig = DEFAULT_LIMITS): LimitReason | null {
  const age = input.accountCreatedAt ? input.now.getTime() - input.accountCreatedAt.getTime() : -1;
  if (age < config.minAccountAgeMs) return 'account_too_new';
  if (importLockedUntil(input.moderationRemovals, input.now, config)) return 'import_locked';
  if (input.attemptsLastHour >= config.perHour || input.attemptsLastDay >= config.perDay) return 'rate_limited';
  if (input.providerCallsToday >= config.dailyBudget) return 'budget_exhausted';
  return null;
}
