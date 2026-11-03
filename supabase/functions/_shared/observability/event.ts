// _shared/observability/event.ts
// Pure builders for Sentry event payloads and envelopes (G41). No I/O here so the
// exact bytes sent to Sentry are unit-tested. Field names follow the Sentry event
// payload and envelope specifications (protocol v7).

import { SDK_NAME, SDK_VERSION } from './dsn.ts';

export type SentryLevel = 'error' | 'warning' | 'info';

export interface StackFrame {
  function?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  /** Frames from our own `file://` modules; remote deps (esm.sh, jsr, node:) are not. */
  in_app: boolean;
}

export interface RequestInfo {
  method: string;
  /** Request URL without query string or fragment (query values may carry PII). */
  url: string;
}

/** Everything the reporter knows about the invocation an event belongs to. */
export interface EventContext {
  environment: string;
  release?: string;
  tags: Record<string, string>;
  request?: RequestInfo;
  extra?: Record<string, unknown>;
}

export interface SentryEvent {
  event_id: string;
  timestamp: string;
  /** `node`: a server runtime. Sentry infers a "user IP" for `javascript` events, which here would be the Edge Runtime's egress address. */
  platform: 'node';
  level: SentryLevel;
  logger: string;
  environment: string;
  release?: string;
  sdk: { name: string; version: string };
  tags: Record<string, string>;
  request?: RequestInfo;
  extra?: Record<string, unknown>;
  exception?: { values: ExceptionValue[] };
  message?: { formatted: string };
}

interface ExceptionValue {
  type: string;
  value: string;
  stacktrace?: { frames: StackFrame[] };
  /** `handled: false` marks a throw that escaped the handler. */
  mechanism: { type: string; handled: boolean };
}

const MECHANISM = 'kc.edge-observability';
const MAX_VALUE_LENGTH = 1000;
// `at fn (file:line:col)` or `at file:line:col`; the optional trailing `)` closes the former.
const V8_FRAME = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/;

/** 32 lowercase hex characters, as Sentry requires for `event_id`. */
export function newEventId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/** Drops query string and fragment; returns the input unchanged when it is not a URL. */
export function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Converts a V8 stack string into Sentry frames, oldest call first (Sentry order).
 * Lines that are not frames (the `Name: message` header, blank lines) are skipped.
 */
export function parseStack(stack: string | undefined): StackFrame[] {
  if (!stack) return [];
  const frames: StackFrame[] = [];
  for (const line of stack.split('\n')) {
    const m = V8_FRAME.exec(line);
    if (!m) continue;
    const [, fnName, filename, lineno, colno] = m;
    frames.push({
      function: fnName ? fnName.replace(/^async\s+/, '') : '<anonymous>',
      filename,
      lineno: Number(lineno),
      colno: Number(colno),
      in_app: filename.startsWith('file://'),
    });
  }
  return frames.reverse();
}

function truncate(text: string): string {
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text;
}

function describeThrown(thrown: unknown): { type: string; value: string; stack?: string } {
  if (thrown instanceof Error) {
    return { type: thrown.name || 'Error', value: truncate(thrown.message), stack: thrown.stack };
  }
  // Supabase/PostgREST error objects are plain objects with a `message`.
  if (thrown && typeof thrown === 'object' && typeof (thrown as { message?: unknown }).message === 'string') {
    const o = thrown as { message: string; name?: unknown; code?: unknown };
    const type = typeof o.name === 'string' ? o.name : typeof o.code === 'string' ? `Error[${o.code}]` : 'Error';
    return { type, value: truncate(o.message) };
  }
  return { type: 'NonError', value: truncate(String(thrown)) };
}

function baseEvent(level: SentryLevel, ctx: EventContext, now: Date): SentryEvent {
  const event: SentryEvent = {
    event_id: newEventId(),
    timestamp: now.toISOString(),
    platform: 'node',
    level,
    logger: 'edge-functions',
    environment: ctx.environment,
    sdk: { name: SDK_NAME, version: SDK_VERSION },
    tags: { ...ctx.tags },
  };
  if (ctx.release) event.release = ctx.release;
  if (ctx.request) event.request = ctx.request;
  if (ctx.extra && Object.keys(ctx.extra).length > 0) event.extra = ctx.extra;
  return event;
}

/** Event for a thrown value. `handled` is false when the throw escaped the handler. */
export function buildExceptionEvent(
  thrown: unknown,
  handled: boolean,
  ctx: EventContext,
  now = new Date(),
): SentryEvent {
  const { type, value, stack } = describeThrown(thrown);
  const frames = parseStack(stack);
  const exception: ExceptionValue = { type, value, mechanism: { type: MECHANISM, handled } };
  if (frames.length > 0) exception.stacktrace = { frames };
  return { ...baseEvent('error', ctx, now), exception: { values: [exception] } };
}

/** Event for a condition without a throwable (for example a 5xx response). */
export function buildMessageEvent(
  message: string,
  level: SentryLevel,
  ctx: EventContext,
  now = new Date(),
): SentryEvent {
  return { ...baseEvent(level, ctx, now), message: { formatted: truncate(message) } };
}

/**
 * Serializes one event as a Sentry envelope: header line, item header line, payload line.
 * `dsn` is echoed in the envelope header as the protocol allows.
 */
export function serializeEnvelope(event: SentryEvent, dsn: string, sentAt = new Date()): string {
  const header = JSON.stringify({
    event_id: event.event_id,
    sent_at: sentAt.toISOString(),
    dsn,
    sdk: { name: SDK_NAME, version: SDK_VERSION },
  });
  const itemHeader = JSON.stringify({ type: 'event', content_type: 'application/json' });
  return `${header}\n${itemHeader}\n${JSON.stringify(event)}\n`;
}
