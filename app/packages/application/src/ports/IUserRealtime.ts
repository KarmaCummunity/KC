import type { AccountStatus, OnboardingState } from '@kc/domain';
// Reuse the existing Unsubscribe type — do NOT redeclare it. IChatRealtime
// already exports `Unsubscribe`; a second declaration re-exported through the
// barrel is a TS2308 "already exported a member named 'Unsubscribe'" error.
import type { Unsubscribe } from './IChatRealtime';

/**
 * The account gate as the server pushes it when it changes: a suspension, a ban, a lifted
 * sanction, a deletion request or its restore, or a new onboarding step (FR-MOD-010 AC4).
 */
export interface AccountChange {
  readonly status: AccountStatus;
  /** End of a temporary suspension; null for every other status. */
  readonly statusUntil: string | null;
  readonly onboardingState: OnboardingState;
}

/**
 * The member's own profile counters as the server pushes them when one changes (FR-KARMA-009).
 */
export interface StatsChange {
  readonly karmaPoints: number;
  readonly followersCount: number;
  readonly followingCount: number;
  readonly itemsGivenCount: number;
  readonly itemsReceivedCount: number;
  readonly postsCreatedTotal: number;
  /** Open posts in every audience, the "only me" ones included (the owner's own view). */
  readonly openPostsCount: number;
}

/**
 * Subscribe to the signed-in member's own account topic (`user:<id>:account`, event
 * `account_changed`). It replaces the `users` row subscription: the app leaves or re-enters the
 * main screens at once instead of at the next request, and re-reads the session on the event.
 * `onError` fires on a dropped or timed-out channel so the consumer can resubscribe (a silent
 * dead socket would otherwise freeze the gate until the next poll).
 */
export interface IUserRealtime {
  subscribeToAccount(
    userId: string,
    onChange: (change: AccountChange) => void,
    onError?: (err: Error) => void,
  ): Unsubscribe;

  /**
   * Subscribe to the member's own counters topic (`user:<id>:stats`, event `stats_changed`):
   * karma and the profile counters update live instead of at the next read (FR-KARMA-009).
   */
  subscribeToStats(
    userId: string,
    onChange: (change: StatsChange) => void,
    onError?: (err: Error) => void,
  ): Unsubscribe;
}
