// The frames of the realtime WebSocket (ADR-011), shared by the API and the app so the two
// cannot drift. Every frame is one JSON object with an `op`.

/** Path of the WebSocket endpoint, under the API's base URL. */
export const REALTIME_PATH = '/v1/realtime';

/** What a subscription carries: events (stored or client-sent), or "who is here". */
export const REALTIME_EXTENSIONS = ['broadcast', 'presence'] as const;
export type RealtimeExtension = (typeof REALTIME_EXTENSIONS)[number];

/** One member present on a topic. `key` is the user id; `meta` is what that member chose to show. */
export interface PresenceMember {
  readonly key: string;
  readonly meta: Readonly<Record<string, unknown>>;
}

/** Frames the app sends. */
export type ClientFrame =
  /** First frame of a connection, and again to replace a token before it expires. */
  | { readonly op: 'auth'; readonly token: string }
  | { readonly op: 'subscribe'; readonly ref: string; readonly topic: string; readonly extension: RealtimeExtension }
  | { readonly op: 'unsubscribe'; readonly ref: string; readonly topic: string; readonly extension: RealtimeExtension }
  /** A client-sent event (typing). Needs the send right on the topic. */
  | { readonly op: 'broadcast'; readonly topic: string; readonly event: string; readonly payload: unknown }
  | { readonly op: 'track'; readonly topic: string; readonly meta: Readonly<Record<string, unknown>> }
  | { readonly op: 'untrack'; readonly topic: string }
  | { readonly op: 'ping' };

/** Why the server refused a frame. */
export type RealtimeErrorCode =
  /** The caller may not do this on the topic (or the topic does not exist: the two look the same). */
  | 'forbidden'
  /** The frame is malformed or names nothing the server knows. */
  | 'bad_frame'
  /** The connection holds as many subscriptions as one connection may. */
  | 'too_many_subscriptions'
  /** The server could not check or carry out the request; trying again later is reasonable. */
  | 'unavailable';

/** Frames the server sends. */
export type ServerFrame =
  /** The token was accepted; subscriptions may follow. */
  | { readonly op: 'ready' }
  | { readonly op: 'ok'; readonly ref: string }
  | { readonly op: 'error'; readonly ref?: string; readonly code: RealtimeErrorCode }
  | { readonly op: 'event'; readonly topic: string; readonly event: string; readonly payload: unknown }
  /** Everyone present on the topic, sent once after a presence subscription. */
  | { readonly op: 'presence_state'; readonly topic: string; readonly members: readonly PresenceMember[] }
  | { readonly op: 'presence_diff'; readonly topic: string; readonly joins: readonly PresenceMember[]; readonly leaves: readonly PresenceMember[] }
  | { readonly op: 'pong' };

/** WebSocket close codes of the endpoint (the 4000 range is the application's). */
export const REALTIME_CLOSE = {
  /** No valid token arrived in time, or the token expired: sign in again, then reconnect. */
  unauthenticated: 4401,
  /** The client broke the protocol (a frame that is not JSON, or too large): a bug, do not reconnect blindly. */
  protocol: 4400,
  /** Too many frames in too short a time: reconnect after a pause. */
  tooFast: 4429,
} as const;

/** Longest frame either side sends, in bytes. */
export const MAX_REALTIME_FRAME_BYTES = 16 * 1024;
