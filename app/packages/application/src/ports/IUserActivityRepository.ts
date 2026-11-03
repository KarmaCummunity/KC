/**
 * Server-side activity record — KC#1058.
 * One active day per user per Israel calendar day (`user_active_days`); it feeds the
 * survey prompt gate `min_active_days_14d` and the PMF retention cross-check.
 */
export interface IUserActivityRepository {
  /** Marks the signed-in caller active today. Idempotent within a day. */
  recordActiveDay(): Promise<void>;
}
