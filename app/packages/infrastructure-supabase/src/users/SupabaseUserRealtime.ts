// Supabase adapter for IUserRealtime: private Broadcast on `user:<id>:account`, event
// `account_changed` (supabase/schemas/40_messaging/090_account_realtime.sql). The payload is the
// account gate itself — status, suspension end, onboarding state — and nothing else. Who may
// listen is the policy on a member's own `user:<id>:…` topics. FR-MOD-010 AC4.
import type { AccountChange, IUserRealtime, Unsubscribe } from '@kc/application';
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
}
