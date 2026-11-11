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
}
