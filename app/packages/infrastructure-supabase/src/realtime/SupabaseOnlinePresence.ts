// Online presence (the green dot).
//
// DEGRADED (map row M24): the baseline has no global presence topic. Its realtime policies admit
// only `chat:<id>:…` topics of a chat the member uses and the member's own `user:<id>:…` topics
// (supabase/schemas/40_messaging/060_realtime.sql), so joining the old `presence:online` topic
// would only be refused and retried. This class therefore keeps the surface the screens use
// (`start`, `stop`, `isOnline`, `getSnapshot`, `subscribe`) but tracks nobody: the online set is
// always empty and no dot turns green. Per-chat presence (`chat:<id>:presence`) is allowed by the
// baseline and is the replacement to build, not part of this migration.

/** The topic the app used to join; kept as the name of what is missing. */
export const ONLINE_PRESENCE_TOPIC = 'presence:online';

export type OnlineListener = (online: ReadonlySet<string>) => void;

const NOBODY: ReadonlySet<string> = new Set();

export class SupabaseOnlinePresence {
  /** Would start tracking `userId` as online; with no topic to join it does nothing. */
  start(_userId: string): void {}

  /** Would leave presence; there is nothing joined to leave. */
  stop(): void {}

  /** Always false: nobody is tracked. */
  isOnline(_userId: string | null | undefined): boolean {
    return false;
  }

  /** The (always empty) set of online member ids. */
  getSnapshot(): ReadonlySet<string> {
    return NOBODY;
  }

  /** Registers a listener that, as the set never changes, is never called; returns its unsubscribe. */
  subscribe(_listener: OnlineListener): () => void {
    return () => undefined;
  }
}
