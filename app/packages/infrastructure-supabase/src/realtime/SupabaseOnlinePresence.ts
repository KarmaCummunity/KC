// Online presence (the green dot) on the global private `presence:online` topic.
//
// One channel per signed-in app session; screens read the shared set of online member ids and
// never open their own channels. The database admits a member to the topic, to track or to
// receive, only while their account is active and their "show my active status" is on
// (migration 0026_member_realtime.sql), so a member who hides their status neither shows up nor
// sees anyone. The app also leaves the channel when the setting is off (useOnlinePresence).

import type { RealtimeChannel } from '@supabase/supabase-js';
import { openExactTopicChannel, type ManagedChannel, type RealtimeHost } from './exactTopicChannel';

export const ONLINE_PRESENCE_TOPIC = 'presence:online';

export type OnlineListener = (online: ReadonlySet<string>) => void;

export class SupabaseOnlinePresence {
  private managed: ManagedChannel | null = null;
  private userId: string | null = null;
  private online: ReadonlySet<string> = new Set();
  private readonly listeners = new Set<OnlineListener>();

  constructor(private readonly client: RealtimeHost) {}

  /** Starts (or keeps) tracking `userId` as online. Idempotent per member. */
  start(userId: string): void {
    if (this.managed && this.userId === userId) return;
    this.stop();
    this.userId = userId;
    this.managed = openExactTopicChannel(
      this.client,
      ONLINE_PRESENCE_TOPIC,
      { private: true, presence: { key: userId } },
      (ch) => {
        ch.on('presence', { event: 'sync' }, () => this.publish(onlineIdsFrom(ch)));
      },
      (status, ch) => {
        if (status === 'SUBSCRIBED') void ch.track({ online_at: new Date().toISOString() });
      },
    );
  }

  /** Leaves presence and drops the channel (background or sign-out). */
  stop(): void {
    this.managed?.close();
    this.managed = null;
    this.userId = null;
    if (this.online.size > 0) this.publish(new Set());
  }

  isOnline(userId: string | null | undefined): boolean {
    return !!userId && this.online.has(userId);
  }

  getSnapshot(): ReadonlySet<string> {
    return this.online;
  }

  subscribe(listener: OnlineListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private publish(next: ReadonlySet<string>): void {
    this.online = next;
    for (const l of this.listeners) l(next);
  }
}

/** The member ids present on the channel. */
export function onlineIdsFrom(ch: Pick<RealtimeChannel, 'presenceState'>): ReadonlySet<string> {
  return new Set(Object.keys(ch.presenceState() ?? {}));
}
