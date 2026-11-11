// SupabaseFeedRealtime — adapter for IFeedRealtime.
// Mapped to SRS: FR-FEED-009 ("↑ N new posts" banner, ≤2s freshness at p95).
//
// Listens on the private `feed:public` Broadcast topic fed by the 0416 trigger
// (Public + open posts; payload carries ids only). posts is deliberately not on
// the supabase_realtime publication (KC#878), so postgres_changes never fired.
//
// Lifecycle: subscribe on feed mount, unsubscribe on unmount / 60s background
// (FR-FEED-009 AC3). On resume the hook gap-fills via REST.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FeedRealtimeCallbacks, IFeedRealtime } from '@kc/application';
import type { Database } from '../database.legacy.types';
import { isChannelFailure, openExactTopicChannel } from '../realtime/exactTopicChannel';

export const FEED_PUBLIC_TOPIC = 'feed:public';

export class SupabaseFeedRealtime implements IFeedRealtime {
  constructor(private readonly client: SupabaseClient<Database>) {}

  subscribeToPublicInserts(cb: FeedRealtimeCallbacks): () => void {
    const managed = openExactTopicChannel(
      this.client,
      FEED_PUBLIC_TOPIC,
      { private: true },
      (ch) => {
        ch.on('broadcast', { event: 'new_post' }, (msg) => {
          const p = (msg.payload ?? {}) as { post_id?: unknown; owner_id?: unknown };
          cb.onNewPublicPost({
            postId: typeof p.post_id === 'string' ? p.post_id : null,
            ownerId: typeof p.owner_id === 'string' ? p.owner_id : null,
          });
        });
      },
      (status) => {
        if (isChannelFailure(status)) cb.onError?.(new Error(`feed channel ${status.toLowerCase()}`));
      },
    );
    return () => managed.close();
  }
}
