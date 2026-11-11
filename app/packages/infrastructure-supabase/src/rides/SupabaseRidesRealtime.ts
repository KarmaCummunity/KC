// SupabaseRidesRealtime — adapter for IRidesRealtime.
// Mapped to: FR-RIDE-016.
//
// Mirrors SupabaseFeedRealtime + SupabaseChatRealtime: subscribe via
// postgres_changes, fire a no-op signal callback (the consumer refetches),
// hand back an unsubscribe.

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  IRidesRealtime,
  RidesRealtimeCallbacks,
  Unsubscribe,
} from '@kc/application';
import type { Database } from '../database.legacy.types';

function uniqueTopic(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

export class SupabaseRidesRealtime implements IRidesRealtime {
  constructor(private readonly client: SupabaseClient<Database>) {}

  subscribeToPublicRideInserts(cb: RidesRealtimeCallbacks): Unsubscribe {
    const channel = this.client
      .channel(uniqueTopic('rides:public-feed'))
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ride_listings',
          filter: 'visibility=eq.Public',
        },
        () => cb.onChange(),
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          cb.onError?.(new Error(`rides feed channel ${status.toLowerCase()}`));
        }
      });
    return () => {
      void this.client.removeChannel(channel);
    };
  }

  subscribeToUserParticipantUpdates(
    userId: string,
    cb: RidesRealtimeCallbacks,
  ): Unsubscribe {
    const channel = this.client
      .channel(uniqueTopic(`rides:participants:user:${userId}`))
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'ride_participants',
          filter: `user_id=eq.${userId}`,
        },
        () => cb.onChange(),
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          cb.onError?.(new Error(`rides participant updates channel ${status.toLowerCase()}`));
        }
      });
    return () => {
      void this.client.removeChannel(channel);
    };
  }

  subscribeToRideParticipantInserts(
    rideId: string,
    cb: RidesRealtimeCallbacks,
  ): Unsubscribe {
    const channel = this.client
      .channel(uniqueTopic(`rides:participants:ride:${rideId}`))
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ride_participants',
          filter: `ride_id=eq.${rideId}`,
        },
        () => cb.onChange(),
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          cb.onError?.(new Error(`rides ride participants channel ${status.toLowerCase()}`));
        }
      });
    return () => {
      void this.client.removeChannel(channel);
    };
  }
}
