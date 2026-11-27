// The channel interface the app's realtime adapters already use, over the API's realtime
// socket (ADR-011 section 5). The adapters were written against the Supabase client's
// `channel` / `removeChannel` / `getChannels` / `realtime.setAuth`; this host gives them the
// same four, so they move to KC's gateway unchanged, the way the data adapters did.

import type { PresenceMember, RealtimeExtension, ServerFrame } from '../wire/realtimeWire';
import type { JoinListener, RealtimeSocket } from './realtimeSocket';

/** Channel states the adapters react to; the names are the ones they already match on. */
export type ChannelStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED';

/** What a broadcast handler receives. */
export interface BroadcastMessage {
  readonly type: 'broadcast';
  readonly event: string;
  readonly payload: unknown;
}

type BroadcastHandler = (message: BroadcastMessage) => void;
type PresenceHandler = () => void;

/** A join that got no answer within this time is reported as timed out. */
const JOIN_TIMEOUT_MS = 10_000;
/** Prefix of a channel's `topic`, as the adapters' stale-channel check expects it. */
const TOPIC_PREFIX = 'realtime:';

export class ApiRealtimeChannel {
  /** `realtime:<topic>`, the form the adapters compare against. */
  readonly topic: string;
  private readonly broadcastHandlers = new Map<string, BroadcastHandler[]>();
  private readonly presenceHandlers: PresenceHandler[] = [];
  /** Member key → what each of their connections shows. */
  private present = new Map<string, PresenceMember['meta']>();
  private readonly joined = new Set<RealtimeExtension>();
  private statusHandler: ((status: ChannelStatus) => void) | null = null;
  private status: ChannelStatus | null = null;
  private joinTimer: unknown = null;
  private isSubscribed = false;
  /** What this member shows while the channel is up; sent again after a reconnect. */
  private trackedMeta: Readonly<Record<string, unknown>> | null = null;

  constructor(
    /** The topic as the database's policies know it. */
    readonly name: string,
    private readonly socket: RealtimeSocket,
    private readonly timers: { set: (callback: () => void, ms: number) => unknown; clear: (timer: unknown) => void },
  ) {
    this.topic = `${TOPIC_PREFIX}${name}`;
  }

  on(type: 'broadcast', filter: { event: string }, handler: BroadcastHandler): this;
  on(type: 'presence', filter: { event: string }, handler: PresenceHandler): this;
  on(type: 'broadcast' | 'presence', filter: { event: string }, handler: BroadcastHandler | PresenceHandler): this {
    if (type === 'presence') this.presenceHandlers.push(handler as PresenceHandler);
    else this.broadcastHandlers.set(filter.event, [...(this.broadcastHandlers.get(filter.event) ?? []), handler as BroadcastHandler]);
    return this;
  }

  /**
   * Joins the topic for what was bound: broadcast when a broadcast handler was bound (or
   * nothing was), presence when a presence handler was. The two are separate rights in the
   * database, so asking for one the channel does not use could only get it refused.
   */
  subscribe(onStatus?: (status: ChannelStatus) => void): this {
    if (this.isSubscribed) return this;
    this.isSubscribed = true;
    this.statusHandler = onStatus ?? null;
    this.joinTimer = this.timers.set(() => this.report('TIMED_OUT'), JOIN_TIMEOUT_MS);
    for (const extension of this.extensions()) this.socket.join(this.name, extension, this.listenerFor(extension));
    return this;
  }

  /** Sends a client event (typing) to the topic's other members. */
  send(message: { type: 'broadcast'; event: string; payload?: unknown }): Promise<'ok' | 'error'> {
    const sent = this.socket.send({ op: 'broadcast', topic: this.name, event: message.event, payload: message.payload ?? null });
    return Promise.resolve(sent ? 'ok' : 'error');
  }

  /** Shows this member as present on the topic. */
  track(meta: Readonly<Record<string, unknown>>): Promise<'ok' | 'error'> {
    this.trackedMeta = meta;
    return Promise.resolve(this.socket.send({ op: 'track', topic: this.name, meta }) ? 'ok' : 'error');
  }

  untrack(): Promise<'ok' | 'error'> {
    this.trackedMeta = null;
    return Promise.resolve(this.socket.send({ op: 'untrack', topic: this.name }) ? 'ok' : 'error');
  }

  /** Who is present, keyed by member id, in the shape the adapters read (`Object.keys`). */
  presenceState(): Record<string, PresenceMember['meta'][]> {
    return Object.fromEntries([...this.present].map(([key, meta]) => [key, [meta]]));
  }

  /** Leaves the topic. Called by the host's `removeChannel`. */
  unsubscribe(): void {
    if (!this.isSubscribed) return;
    this.isSubscribed = false;
    this.clearJoinTimer();
    for (const extension of this.extensions()) this.socket.leave(this.name, extension);
    this.joined.clear();
    this.present = new Map();
    this.report('CLOSED');
  }

  private extensions(): RealtimeExtension[] {
    const wanted: RealtimeExtension[] = [];
    if (this.broadcastHandlers.size > 0 || this.presenceHandlers.length === 0) wanted.push('broadcast');
    if (this.presenceHandlers.length > 0) wanted.push('presence');
    return wanted;
  }

  private listenerFor(extension: RealtimeExtension): JoinListener {
    return {
      onJoined: () => {
        this.joined.add(extension);
        if (this.joined.size < this.extensions().length) return;
        this.clearJoinTimer();
        this.report('SUBSCRIBED');
        // Presence is per connection: after a reconnect the server no longer knows this member is here.
        if (this.trackedMeta && extension === 'presence') void this.track(this.trackedMeta);
      },
      onDown: () => {
        this.joined.delete(extension);
        this.clearJoinTimer();
        this.report('CHANNEL_ERROR');
      },
      onFrame: (frame) => this.receive(frame),
    };
  }

  private receive(frame: ServerFrame): void {
    if (frame.op === 'event') {
      for (const handler of this.broadcastHandlers.get(frame.event) ?? []) handler({ type: 'broadcast', event: frame.event, payload: frame.payload });
      return;
    }
    if (frame.op === 'presence_state') this.present = new Map(frame.members.map((member) => [member.key, member.meta]));
    if (frame.op === 'presence_diff') {
      for (const member of frame.leaves) this.present.delete(member.key);
      for (const member of frame.joins) this.present.set(member.key, member.meta);
    }
    if (frame.op === 'presence_state' || frame.op === 'presence_diff') for (const handler of this.presenceHandlers) handler();
  }

  /** Tells the adapter about a state, once per change. */
  private report(status: ChannelStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.statusHandler?.(status);
  }

  private clearJoinTimer(): void {
    if (this.joinTimer !== null) this.timers.clear(this.joinTimer);
    this.joinTimer = null;
  }
}

/** The four members of the Supabase client the realtime adapters use. */
export interface ApiRealtimeHost {
  channel(topic: string, options?: { config?: unknown }): ApiRealtimeChannel;
  removeChannel(channel: ApiRealtimeChannel): Promise<'ok'>;
  getChannels(): ApiRealtimeChannel[];
  readonly realtime: { setAuth(): Promise<void> };
}

/**
 * @param socket The app's one realtime connection.
 * @param timers Replaceable in tests.
 */
export function createApiRealtimeHost(
  socket: RealtimeSocket,
  timers = { set: (callback: () => void, ms: number): unknown => setTimeout(callback, ms), clear: (timer: unknown) => clearTimeout(timer as never) },
): ApiRealtimeHost {
  const channels = new Set<ApiRealtimeChannel>();
  return {
    channel(topic) {
      const channel = new ApiRealtimeChannel(topic, socket, timers);
      channels.add(channel);
      return channel;
    },
    removeChannel(channel) {
      channel.unsubscribe();
      channels.delete(channel);
      return Promise.resolve('ok');
    },
    getChannels: () => [...channels],
    realtime: { setAuth: () => socket.refreshAuth() },
  };
}
