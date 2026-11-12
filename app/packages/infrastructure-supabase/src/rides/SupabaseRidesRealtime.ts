// SupabaseRidesRealtime — adapter for IRidesRealtime.
// Mapped to spec: FR-RIDE-016.
//
// DEGRADED (map rows M24): the baseline has no ride topics — a ride is a post and the realtime
// registry holds only `chat:*` and `user:*` topics (supabase/schemas/40_messaging/060_realtime.sql),
// and no table is on a publication, so the old postgres_changes subscriptions have nothing to
// read. Each subscription reports `BackendUnavailableError` once through `onError` and returns a
// no-op unsubscribe; the ride screens refresh on focus and on pull. When the baseline gains ride
// topics, this is the one file to restore (the previous implementation is in git history).

import { BackendUnavailableError } from '@kc/domain';
import type { IRidesRealtime, RidesRealtimeCallbacks, Unsubscribe } from '@kc/application';

/** Tells the consumer that `topic` does not exist and returns the unsubscribe of a subscription that never opened. */
function unavailable(topic: string, cb: RidesRealtimeCallbacks): Unsubscribe {
  cb.onError?.(new BackendUnavailableError(`channel:${topic}`, 'relation'));
  return () => undefined;
}

export class SupabaseRidesRealtime implements IRidesRealtime {
  subscribeToPublicRideInserts(cb: RidesRealtimeCallbacks): Unsubscribe {
    return unavailable('rides:public-feed', cb);
  }

  subscribeToUserParticipantUpdates(userId: string, cb: RidesRealtimeCallbacks): Unsubscribe {
    return unavailable(`rides:participants:user:${userId}`, cb);
  }

  subscribeToRideParticipantInserts(rideId: string, cb: RidesRealtimeCallbacks): Unsubscribe {
    return unavailable(`rides:participants:ride:${rideId}`, cb);
  }
}
