// SupabaseFeedRealtime — adapter for IFeedRealtime.
// Mapped to spec: FR-FEED-009 ("↑ N new posts" banner).
//
// DEGRADED (map row M24): the baseline has no broadcast of new public posts — no `feed:public`
// topic, no policy and no trigger (supabase/schemas/40_messaging/060_realtime.sql registers only
// `chat:*` and `user:*`). Opening the old topic would only be refused by the realtime service
// and retried forever, so the adapter opens nothing: it reports `BackendUnavailableError` once
// through `onError` and hands back a no-op unsubscribe. The feed still refreshes on pull and on
// focus; only the live "new posts" pill is gone. When the baseline gains the topic, this is the
// one file to restore (the previous implementation is in git history).

import { BackendUnavailableError } from '@kc/domain';
import type { FeedRealtimeCallbacks, IFeedRealtime } from '@kc/application';

/** The topic the app used to listen to; named only so the degrade report says what is missing. */
export const FEED_PUBLIC_TOPIC = 'feed:public';

export class SupabaseFeedRealtime implements IFeedRealtime {
  subscribeToPublicInserts(cb: FeedRealtimeCallbacks): () => void {
    cb.onError?.(new BackendUnavailableError(`channel:${FEED_PUBLIC_TOPIC}`, 'relation'));
    return () => undefined;
  }
}
