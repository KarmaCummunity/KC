import { randomUUID } from 'node:crypto';
import {
  type ClientFrame,
  MAX_REALTIME_FRAME_BYTES,
  REALTIME_CLOSE,
  REALTIME_EXTENSIONS,
  type RealtimeErrorCode,
  type RealtimeExtension,
  type ServerFrame,
} from '@kc/infrastructure-api';
import { type AccessTokenVerifier, InvalidAccessTokenError } from '../identity/accessTokenVerifier';
import type { CallerIdentity } from '../identity/callerIdentity';
import type { EphemeralEvents } from './ephemeralEvents';
import type { HubSubscriber, RealtimeHub } from './realtimeHub';
import type { TopicAccess, TopicAuthorizer } from './topicAuthorizer';

/** The socket, as a connection uses it. */
export interface RealtimeSocket {
  send(text: string): void;
  close(code: number): void;
}

export interface ConnectionDeps {
  readonly verifier: AccessTokenVerifier;
  readonly authorizer: Pick<TopicAuthorizer, 'accessOf'>;
  readonly hub: RealtimeHub;
  readonly ephemeral: EphemeralEvents;
  /** Receives a failure of the server itself (for the log). */
  readonly report: (error: unknown) => void;
  /** Current time in milliseconds; replaced in tests. */
  readonly now?: () => number;
}

/** Subscriptions one connection may hold: far above what the app opens, far below what would let one socket exhaust a server. */
export const MAX_SUBSCRIPTIONS = 100;
/** Frames one connection may send per second, sustained; twice that in a burst. */
export const MAX_FRAMES_PER_SECOND = 20;
const MAX_EVENT_NAME_LENGTH = 64;

interface Subscription {
  readonly topic: string;
  readonly extension: RealtimeExtension;
  /** The `ref` of the subscribe frame, quoted if the subscription is later withdrawn. */
  readonly ref: string;
  readonly access: TopicAccess;
}

const keyOf = (extension: RealtimeExtension, topic: string) => `${extension}:${topic}`;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isExtension = (value: unknown): value is RealtimeExtension => (REALTIME_EXTENSIONS as readonly unknown[]).includes(value);

/**
 * One client's side of the realtime protocol (ADR-011 section 1): it turns
 * frames into verified, authorized actions on the hub. Nothing reaches the
 * hub before the token is verified and the topic's policy allowed it.
 */
export class RealtimeConnection implements HubSubscriber {
  readonly id = randomUUID();
  private caller: CallerIdentity | null = null;
  private readonly subscriptions = new Map<string, Subscription>();
  /** Topics this connection's member is shown as present on. */
  private readonly tracked = new Set<string>();
  /** Token bucket of the frame rate limit. */
  private allowance = 2 * MAX_FRAMES_PER_SECOND;
  private allowanceAt: number;
  private isClosed = false;

  constructor(
    private readonly socket: RealtimeSocket,
    private readonly deps: ConnectionDeps,
  ) {
    this.allowanceAt = this.now();
  }

  /** True once a valid token arrived. */
  get isAuthenticated(): boolean {
    return this.caller !== null;
  }

  /** When the current token expires (milliseconds), or null before authentication. */
  get tokenExpiresAt(): number | null {
    const expiry = this.caller?.claims.exp;
    return typeof expiry === 'number' ? expiry * 1000 : null;
  }

  send(frame: ServerFrame): void {
    if (!this.isClosed) this.socket.send(JSON.stringify(frame));
  }

  /** Handles one frame from the client. Never rejects: a failure becomes an `error` frame or closes the socket. */
  async receive(text: string): Promise<void> {
    if (this.isClosed) return;
    if (!this.withinRate()) return this.close(REALTIME_CLOSE.tooFast);
    const frame = text.length <= MAX_REALTIME_FRAME_BYTES ? parseFrame(text) : null;
    if (!frame) return this.close(REALTIME_CLOSE.protocol);
    if (frame.op === 'auth') return this.authenticate(frame.token);
    // Everything else needs a caller; the token must come first.
    if (!this.caller) return this.close(REALTIME_CLOSE.unauthenticated);
    try {
      await this.handle(frame, this.caller);
    } catch (error) {
      this.deps.report(error);
      this.send({ op: 'error', ...('ref' in frame ? { ref: frame.ref } : {}), code: 'unavailable' });
    }
  }

  /** Releases everything the connection holds. Called once, when the socket closes. */
  release(): void {
    this.isClosed = true;
    const key = this.caller?.userId;
    for (const topic of this.tracked) if (key) void this.deps.ephemeral.untrack(topic, this.id, key).catch(this.deps.report);
    for (const subscription of this.subscriptions.values()) this.deps.hub.unsubscribe(this.id, subscription.topic, subscription.extension);
    this.tracked.clear();
    this.subscriptions.clear();
  }

  /** Ends the connection with an application close code. */
  close(code: number): void {
    if (this.isClosed) return;
    this.release();
    this.socket.close(code);
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  /** Refills the bucket for the time that passed and takes one token. */
  private withinRate(): boolean {
    const now = this.now();
    this.allowance = Math.min(2 * MAX_FRAMES_PER_SECOND, this.allowance + ((now - this.allowanceAt) / 1000) * MAX_FRAMES_PER_SECOND);
    this.allowanceAt = now;
    if (this.allowance < 1) return false;
    this.allowance -= 1;
    return true;
  }

  /** Accepts a first token, or replaces the token of the same member and re-checks what they hold. */
  private async authenticate(token: string): Promise<void> {
    let caller: CallerIdentity;
    try {
      caller = await this.deps.verifier.verify(token);
    } catch (error) {
      if (!(error instanceof InvalidAccessTokenError)) this.deps.report(error);
      return this.close(REALTIME_CLOSE.unauthenticated);
    }
    // A connection belongs to one member for its whole life.
    if (this.caller && this.caller.userId !== caller.userId) return this.close(REALTIME_CLOSE.unauthenticated);
    const isFirst = this.caller === null;
    this.caller = caller;
    if (isFirst) return this.send({ op: 'ready' });
    await this.recheckSubscriptions(caller).catch((error: unknown) => this.deps.report(error));
  }

  /** Withdraws the subscriptions the member may no longer hold (ADR-011: checked again when the token is replaced). */
  private async recheckSubscriptions(caller: CallerIdentity): Promise<void> {
    for (const [key, subscription] of [...this.subscriptions]) {
      const access = await this.deps.authorizer.accessOf(caller, subscription.topic, subscription.extension);
      if (access.receive) {
        this.subscriptions.set(key, { ...subscription, access });
        continue;
      }
      this.drop(subscription, caller);
      this.send({ op: 'error', ref: subscription.ref, code: 'forbidden' });
    }
  }

  private async handle(frame: Exclude<ClientFrame, { op: 'auth' }>, caller: CallerIdentity): Promise<void> {
    switch (frame.op) {
      case 'ping':
        return this.send({ op: 'pong' });
      case 'subscribe':
        return this.subscribe(frame.ref, frame.topic, frame.extension, caller);
      case 'unsubscribe': {
        const subscription = this.subscriptions.get(keyOf(frame.extension, frame.topic));
        if (subscription) this.drop(subscription, caller);
        return this.send({ op: 'ok', ref: frame.ref });
      }
      case 'broadcast':
        return this.broadcast(frame.topic, frame.event, frame.payload);
      case 'track':
        return this.track(frame.topic, frame.meta, caller);
      case 'untrack':
        if (this.tracked.delete(frame.topic)) await this.deps.ephemeral.untrack(frame.topic, this.id, caller.userId);
    }
  }

  private async subscribe(ref: string, topic: string, extension: RealtimeExtension, caller: CallerIdentity): Promise<void> {
    const refuse = (code: RealtimeErrorCode) => this.send({ op: 'error', ref, code });
    const key = keyOf(extension, topic);
    if (!this.subscriptions.has(key) && this.subscriptions.size >= MAX_SUBSCRIPTIONS) return refuse('too_many_subscriptions');
    const access = await this.deps.authorizer.accessOf(caller, topic, extension);
    // The socket may have closed while the database was asked.
    if (this.isClosed) return;
    if (!access.receive) return refuse('forbidden');
    this.subscriptions.set(key, { topic, extension, ref, access });
    this.deps.hub.subscribe(this, topic, extension);
    this.send({ op: 'ok', ref });
    if (extension === 'presence') this.send({ op: 'presence_state', topic, members: await this.deps.ephemeral.membersOf(topic) });
  }

  /** A client-sent event goes to the topic's other subscribers, if this member may send on the topic they joined. */
  private broadcast(topic: string, event: string, payload: unknown): void {
    if (!this.subscriptions.get(keyOf('broadcast', topic))?.access.send) return this.send({ op: 'error', code: 'forbidden' });
    this.deps.ephemeral.broadcast(topic, event, payload, this.id);
  }

  private async track(topic: string, meta: Readonly<Record<string, unknown>>, caller: CallerIdentity): Promise<void> {
    if (!this.subscriptions.get(keyOf('presence', topic))?.access.send) return this.send({ op: 'error', code: 'forbidden' });
    this.tracked.add(topic);
    // The key is the verified member, never a value the client chose.
    await this.deps.ephemeral.track(topic, this.id, { key: caller.userId, meta });
  }

  private drop(subscription: Subscription, caller: CallerIdentity): void {
    this.subscriptions.delete(keyOf(subscription.extension, subscription.topic));
    this.deps.hub.unsubscribe(this.id, subscription.topic, subscription.extension);
    if (subscription.extension === 'presence' && this.tracked.delete(subscription.topic)) {
      void this.deps.ephemeral.untrack(subscription.topic, this.id, caller.userId).catch(this.deps.report);
    }
  }
}

/** A frame of a known shape, or null. Only the fields of the shape are kept. */
export function parseFrame(text: string): ClientFrame | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(value)) return null;
  const isText = (field: unknown, max = Number.MAX_SAFE_INTEGER): field is string => typeof field === 'string' && field.length > 0 && field.length <= max;
  switch (value.op) {
    case 'auth':
      return isText(value.token) ? { op: 'auth', token: value.token } : null;
    case 'subscribe':
    case 'unsubscribe':
      return isText(value.ref, MAX_EVENT_NAME_LENGTH) && isText(value.topic) && isExtension(value.extension)
        ? { op: value.op, ref: value.ref, topic: value.topic, extension: value.extension }
        : null;
    case 'broadcast':
      return isText(value.topic) && isText(value.event, MAX_EVENT_NAME_LENGTH) ? { op: 'broadcast', topic: value.topic, event: value.event, payload: value.payload ?? null } : null;
    case 'track':
      return isText(value.topic) && isObject(value.meta ?? {}) ? { op: 'track', topic: value.topic, meta: (value.meta ?? {}) as Record<string, unknown> } : null;
    case 'untrack':
      return isText(value.topic) ? { op: 'untrack', topic: value.topic } : null;
    case 'ping':
      return { op: 'ping' };
    default:
      return null;
  }
}
