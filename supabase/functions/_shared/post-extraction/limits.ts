// supabase/functions/_shared/post-extraction/limits.ts
// Who may run an extraction right now (FR-IMPORT-008 AC3-AC4). Pure decision over counts the
// store provides; a refusal is never an error for the member: the draft just falls back to the
// manual route with the reason.

export interface LimitConfig {
  /** An account younger than this cannot import. */
  minAccountAgeMs: number;
  perHour: number;
  perDay: number;
  /** Model calls the whole service may make per day; the cache and the manual route stay available. */
  dailyBudget: number;
}

export const DEFAULT_LIMITS: LimitConfig = {
  minAccountAgeMs: 24 * 60 * 60 * 1000,
  perHour: 5,
  perDay: 20,
  dailyBudget: 2000,
};

export type LimitReason = 'account_too_new' | 'rate_limited' | 'budget_exhausted';

export interface LimitInputs {
  /** From the verified token; unknown fails closed as too new. */
  accountCreatedAt: Date | null;
  now: Date;
  /** The member's attempts, cache hits and manual routes included. */
  attemptsLastHour: number;
  attemptsLastDay: number;
  /** Model calls made by everyone since the start of the UTC day. */
  providerCallsToday: number;
}

/** The first limit that applies, or null when the extraction may run. */
export function checkLimits(input: LimitInputs, config: LimitConfig = DEFAULT_LIMITS): LimitReason | null {
  const age = input.accountCreatedAt ? input.now.getTime() - input.accountCreatedAt.getTime() : -1;
  if (age < config.minAccountAgeMs) return 'account_too_new';
  if (input.attemptsLastHour >= config.perHour || input.attemptsLastDay >= config.perDay) return 'rate_limited';
  if (input.providerCallsToday >= config.dailyBudget) return 'budget_exhausted';
  return null;
}
