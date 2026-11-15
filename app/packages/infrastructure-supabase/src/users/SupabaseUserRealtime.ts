// Supabase adapter for IUserRealtime: two private Broadcast topics of the member's own.
//   `user:<id>:account`, event `account_changed` (supabase/schemas/40_messaging/090_account_realtime.sql):
//   the account gate itself — status, suspension end, onboarding state. FR-MOD-010 AC4.
//   `user:<id>:stats`, event `stats_changed` (migration 0026_member_realtime.sql): the member's
//   karma and profile counters. FR-KARMA-009.
// Who may listen is the policy on a member's own `user:<id>:…` topics.
import type { AccountChange, IUserRealtime, StatsChange, Unsubscribe } from '@kc/application';
import type { AccountStatus, OnboardingState } from '@kc/domain';
import {
  isChannelFailure,
  openExactTopicChannel,
  type RealtimeHost,
} from '../realtime/exactTopicChannel';

/** Broadcast event the account trigger sends. */
export const ACCOUNT_CHANGED_EVENT = 'account_changed';

/** Reads the broadcast payload; null when it does not carry a status and an onboarding state. */
export function parseAccountChange(payload: unknown): AccountChange | null {
  const raw = (payload ?? {}) as Record<string, unknown>;
  if (typeof raw['status'] !== 'string' || typeof raw['onboarding_state'] !== 'string') return null;
  return {
    status: raw['status'] as AccountStatus,
    statusUntil: typeof raw['status_until'] === 'string' ? raw['status_until'] : null,
    onboardingState: raw['onboarding_state'] as OnboardingState,
  };
}

/** Broadcast event the counters trigger sends. */
export const STATS_CHANGED_EVENT = 'stats_changed';

const STATS_FIELDS: ReadonlyArray<readonly [keyof StatsChange, string]> = [
  ['karmaPoints', 'karma_points'],
  ['followersCount', 'followers_count'],
  ['followingCount', 'following_count'],
  ['itemsGivenCount', 'items_given_count'],
  ['itemsReceivedCount', 'items_received_count'],
  ['postsCreatedTotal', 'posts_created_total'],
  ['openPostsCount', 'open_posts_count'],
];

/** Reads the counters payload; null when any counter is missing or not a number. */
export function parseStatsChange(payload: unknown): StatsChange | null {
  const raw = (payload ?? {}) as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const [field, column] of STATS_FIELDS) {
    const value = raw[column];
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    out[field] = value;
  }
  return out as unknown as StatsChange;
}

export class SupabaseUserRealtime implements IUserRealtime {
  constructor(private readonly client: RealtimeHost) {}

  subscribeToAccount(
    userId: string,
    onChange: (change: AccountChange) => void,
    onError?: (err: Error) => void,
  ): Unsubscribe {
    // The private topic of the member's account gate; the database policy admits only its owner.
    const topic = `user:${userId}:account`;
    const managed = openExactTopicChannel(
      this.client,
      topic,
      { private: true },
      (channel) => {
        channel.on('broadcast', { event: ACCOUNT_CHANGED_EVENT }, (message) => {
          const change = parseAccountChange(message.payload);
          if (change) onChange(change);
        });
      },
      (status) => {
        if (isChannelFailure(status)) onError?.(new Error(`account channel ${status.toLowerCase()}`));
      },
    );
    return () => managed.close();
  }

  subscribeToStats(
    userId: string,
    onChange: (change: StatsChange) => void,
    onError?: (err: Error) => void,
  ): Unsubscribe {
    const managed = openExactTopicChannel(
      this.client,
      `user:${userId}:stats`,
      { private: true },
      (channel) => {
        channel.on('broadcast', { event: STATS_CHANGED_EVENT }, (message) => {
          const change = parseStatsChange(message.payload);
          if (change) onChange(change);
        });
      },
      (status) => {
        if (isChannelFailure(status)) onError?.(new Error(`stats channel ${status.toLowerCase()}`));
      },
    );
    return () => managed.close();
  }
}
