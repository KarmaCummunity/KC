// The app's one WebSocket to the API's realtime endpoint (ADR-011 section 5): connect,
// authenticate, heartbeat, reconnect with back-off, and re-join what was joined. Channels
// (`apiRealtimeHost.ts`) sit on top of it; nothing here knows what a topic means.

import { type ClientFrame, REALTIME_CLOSE, type RealtimeErrorCode, type RealtimeExtension, type ServerFrame } from '../wire/realtimeWire';

/** The part of a WebSocket this client uses; the global `WebSocket` of React Native, browsers and Node fits it. */
export interface SocketLike {
  send(data: string): void;
  close(code?: number): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export interface RealtimeSocketOptions {
  /** `ws://` or `wss://` address of the endpoint. */
  readonly url: string;
  /** The member's access token, or null when signed out. `forceRefresh` is true after the server refused the token. */
  readonly getAccessToken: (forceRefresh: boolean) => Promise<string | null>;
  /** Opens a socket; the global `WebSocket` by default. */
  readonly createSocket?: (url: string) => SocketLike;
  /** Timers, replaceable in tests. */
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (timer: unknown) => void;
}

/** What one joined (topic, extension) hears from the socket. */
export interface JoinListener {
  /** The server accepted the join (also after every reconnect). */
  onJoined(): void;
  /** The server refused the join, or the connection was lost; a lost connection is re-joined by itself. */
  onDown(reason: RealtimeErrorCode | 'disconnected'): void;
  onFrame(frame: ServerFrame): void;
}

interface Join {
  readonly topic: string;
  readonly extension: RealtimeExtension;
  readonly listener: JoinListener;
}

/** Waits between reconnect attempts; the last one repeats. */
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000];
/** How often the client pings, so a dead connection is noticed even when no event is due. */
const HEARTBEAT_INTERVAL_MS = 25_000;

const keyOf = (extension: RealtimeExtension, topic: string) => `${extension}:${topic}`;

export class RealtimeSocket {
  private socket: SocketLike | null = null;
  /** True between the server's `ready` and the close of the socket. */
  private isReady = false;
  private readonly joins = new Map<string, Join>();
  /** `ref` of a subscribe frame → the join it asked for. */
  private readonly pending = new Map<string, Join>();
  private refSequence = 0;
  private attempts = 0;
  private reconnectTimer: unknown = null;
  private heartbeatTimer: unknown = null;
  /** The token the server holds for this connection. */
  private sentToken: string | null = null;
  /** After the server refused the token, the next one is asked for with `forceRefresh`. */
  private mustRefreshToken = false;
  /** A heartbeat was sent and nothing has arrived since. */
  private awaitingPong = false;

  constructor(private readonly options: RealtimeSocketOptions) {}

  /** Joins a topic. The connection is opened by the first join and closed after the last leave. */
  join(topic: string, extension: RealtimeExtension, listener: JoinListener): void {
    const join: Join = { topic, extension, listener };
    this.joins.set(keyOf(extension, topic), join);
    if (this.isReady) this.sendJoin(join);
    else void this.connect();
  }

  leave(topic: string, extension: RealtimeExtension): void {
    if (!this.joins.delete(keyOf(extension, topic))) return;
    if (this.isReady) this.send({ op: 'unsubscribe', ref: this.nextRef(), topic, extension });
    if (this.joins.size === 0) this.disconnect();
  }

  /** Sends a frame when connected. @returns false when it could not be sent. */
  send(frame: ClientFrame): boolean {
    if (!this.socket || !this.isReady) return false;
    this.socket.send(JSON.stringify(frame));
    return true;
  }

  /** Gives the server the member's current token when it changed, so the connection outlives a token refresh. */
  async refreshAuth(): Promise<void> {
    if (!this.isReady) return;
    const token = await this.options.getAccessToken(false);
    if (token && token !== this.sentToken && this.send({ op: 'auth', token })) this.sentToken = token;
  }

  private nextRef(): string {
    this.refSequence += 1;
    return `r${this.refSequence}`;
  }

  private sendJoin(join: Join): void {
    const ref = this.nextRef();
    this.pending.set(ref, join);
    this.send({ op: 'subscribe', ref, topic: join.topic, extension: join.extension });
  }

  private async connect(): Promise<void> {
    if (this.socket || this.joins.size === 0) return;
    const create = this.options.createSocket ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);
    const socket = create(this.options.url);
    this.socket = socket;
    socket.onopen = () => void this.authenticate(socket);
    socket.onmessage = (event) => this.receive(String(event.data));
    socket.onclose = (event) => this.closed(socket, event.code);
    // An error is always followed by a close, which is where the state is handled.
    socket.onerror = () => undefined;
  }

  private async authenticate(socket: SocketLike): Promise<void> {
    const token = await this.options.getAccessToken(this.mustRefreshToken).catch(() => null);
    this.mustRefreshToken = false;
    // The socket may have been replaced or closed while the token was read.
    if (this.socket !== socket) return;
    // Signed out: nothing can be joined, and the channels stay down until a new join after sign-in.
    if (!token) return socket.close();
    this.sentToken = token;
    socket.send(JSON.stringify({ op: 'auth', token } satisfies ClientFrame));
  }

  private receive(text: string): void {
    let frame: ServerFrame;
    try {
      frame = JSON.parse(text) as ServerFrame;
    } catch {
      return;
    }
    this.awaitingPong = false;
    switch (frame.op) {
      case 'ready':
        return this.ready();
      case 'ok':
        return this.take(frame.ref)?.listener.onJoined();
      case 'error':
        // An error without a ref answers a send or a track; the channel that sent it has no use for it.
        return frame.ref ? this.take(frame.ref)?.listener.onDown(frame.code) : undefined;
      case 'event':
        return this.joins.get(keyOf('broadcast', frame.topic))?.listener.onFrame(frame);
      case 'presence_state':
      case 'presence_diff':
        return this.joins.get(keyOf('presence', frame.topic))?.listener.onFrame(frame);
      case 'pong':
        return;
    }
  }

  /** The join a server answer refers to, if it is still wanted. */
  private take(ref: string): Join | undefined {
    const join = this.pending.get(ref);
    this.pending.delete(ref);
    return join && this.joins.get(keyOf(join.extension, join.topic)) === join ? join : undefined;
  }

  private ready(): void {
    this.isReady = true;
    this.attempts = 0;
    for (const join of this.joins.values()) this.sendJoin(join);
    this.startHeartbeat();
  }

  private startHeartbeat(): void {
    const setTimer = this.options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.heartbeatTimer = setTimer(() => {
      // Nothing arrived since the last ping: the connection is dead even if no close was seen.
      if (this.awaitingPong) return this.socket?.close();
      this.awaitingPong = this.send({ op: 'ping' });
      this.startHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
  }

  private closed(socket: SocketLike, code: number): void {
    if (this.socket !== socket) return;
    this.resetConnection();
    for (const join of this.joins.values()) join.listener.onDown('disconnected');
    // A protocol error is a bug in this client: reconnecting would only repeat it.
    if (code === REALTIME_CLOSE.protocol || this.joins.size === 0) return;
    if (code === REALTIME_CLOSE.unauthenticated) this.mustRefreshToken = true;
    const delay = RECONNECT_DELAYS_MS[Math.min(this.attempts, RECONNECT_DELAYS_MS.length - 1)] as number;
    this.attempts += 1;
    const setTimer = this.options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.reconnectTimer = setTimer(() => void this.connect(), delay);
  }

  /** Closes the connection because nothing is joined any more. */
  private disconnect(): void {
    const socket = this.socket;
    this.resetConnection();
    socket?.close();
  }

  private resetConnection(): void {
    const clearTimer = this.options.clearTimer ?? ((timer) => clearTimeout(timer as never));
    if (this.heartbeatTimer !== null) clearTimer(this.heartbeatTimer);
    if (this.reconnectTimer !== null) clearTimer(this.reconnectTimer);
    this.heartbeatTimer = this.reconnectTimer = null;
    this.socket = null;
    this.isReady = false;
    this.awaitingPong = false;
    this.sentToken = null;
    this.pending.clear();
  }
}
