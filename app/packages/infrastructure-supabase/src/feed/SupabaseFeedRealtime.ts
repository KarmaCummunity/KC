// SupabaseFeedRealtime — adapter for IFeedRealtime.
// Mapped to spec: FR-FEED-009 AC2 ("↑ N new posts" pill).
//
// Listens on the private `feed:public` Broadcast topic (migration 0026_member_realtime.sql): a
// post that becomes open and Public sends a ping with its id and its owner's id, nothing else.
// The app re-reads the feed through row security when the member taps the pill.
//
// Lifecycle: subscribe on feed mount, unsubscribe on unmount or after 60 s in the background
// (FR-FEED-009 AC3). On resume the hook fills the gap through a normal read.

import type { FeedRealtimeCallbacks, IFeedRealtime } from '@kc/application';
import { isChannelFailure, openExactTopicChannel, type RealtimeHost } from '../realtime/exactTopicChannel';

export const FEED_PUBLIC_TOPIC = 'feed:public';

export class SupabaseFeedRealtime implements IFeedRealtime {
  constructor(private readonly client: RealtimeHost) {}

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
