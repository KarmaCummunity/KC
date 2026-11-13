// Mapped to docs/superpowers/specs/2026-05-25-app-performance-overhaul-design.md § Wave 0.
//
// Helpers around Sentry's transaction API.
//   - When no DSN is configured (typical dev environment): never load the SDK.
//     `startMark` records a start time locally; `finishMark` discards it. Zero
//     bundle/runtime cost beyond a Map insert.
//   - When a DSN is configured: `initSentry()` is deferred past first paint, so a mark
//     usually starts (and the cold-start mark finishes) before the SDK exists. A mark is
//     therefore a pair of timestamps; `finishMark` turns it into a Sentry span with those
//     explicit times once the SDK is up, or queues it and `flushPendingMarks()` sends it
//     right after init. (Spans started through the SDK before init were silently dropped,
//     so no mark ever reached Sentry.)
//   - `finish` returns boolean so callers can detect double-finish.
//   - Sentry v7 used span.finish(); v8 renamed to span.end(). We call whichever
//     exists so the helper survives major-version bumps without crashing the
//     host app (which is what TypeError: s.finish is not a function would do).
//
// We read DSN directly from process.env (not from ./sentry) so this module
// doesn't transitively pull expo-constants at vitest load — keeps the unit
// tests environment-light.

const HAS_DSN: boolean = Boolean(process.env.EXPO_PUBLIC_SENTRY_DSN);

// Lazy import of ./sentry so module-load of perfMarks doesn't drag in
// expo-constants. Only resolved when HAS_DSN is true.
type SentryGate = { getSentryIfInit: () => typeof import('@sentry/react-native') | null };
let sentryGate: SentryGate | null = null;
function getGate(): SentryGate | null {
  if (!HAS_DSN) return null;
  if (sentryGate) return sentryGate;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sentryGate = require('./sentry') as SentryGate;
    return sentryGate;
  } catch {
    return null;
  }
}

type MarkName = 'app.cold_start' | 'feed.first_render' | 'image.first_paint' | 'post_detail.content_painted';
type Span = { end?(endTimestamp?: number): void; finish?(): void };
type FinishedMark = { name: MarkName; startMs: number; endMs: number };

const coldStartT0 =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : 0;

/** Wall-clock start of every mark that is running (ms since the epoch). */
const active = new Map<MarkName, number>();
/** Marks that finished before Sentry was initialised, sent by `flushPendingMarks`. */
const pending: FinishedMark[] = [];
/** A session with a DSN but a failed init must not grow this queue without bound. */
const MAX_PENDING_MARKS = 20;
let lastColdStartMs: number | null = null;

function endSpan(span: Span, endSec: number): void {
  try {
    if (typeof span.end === 'function') {
      span.end(endSec);
      return;
    }
    if (typeof span.finish === 'function') {
      span.finish();
    }
  } catch {
    // Never crash the host app on a Sentry span-end failure.
  }
}

/** Sends one finished mark as a span with its real start and end (Sentry takes seconds). */
function report(mark: FinishedMark): boolean {
  const Sentry = getGate()?.getSentryIfInit();
  if (!Sentry) return false;
  try {
    const span = Sentry.startInactiveSpan({
      name: mark.name,
      op: 'mark',
      startTime: mark.startMs / 1000,
    }) as unknown as Span | undefined;
    if (span) endSpan(span, mark.endMs / 1000);
  } catch {
    // A span failure must not reach the host app.
  }
  return true;
}

export function startMark(name: MarkName): void {
  if (active.has(name)) return;
  active.set(name, Date.now());
}

export function finishMark(name: MarkName): boolean {
  const startMs = active.get(name);
  if (startMs === undefined) return false;
  active.delete(name);
  const endMs = Date.now();
  if (name === 'app.cold_start' && coldStartT0 > 0) {
    lastColdStartMs = Math.round(performance.now() - coldStartT0);
  }
  // No DSN: nothing to send. With a DSN, send now or keep the mark until init has settled.
  if (!getGate()) return true;
  const mark = { name, startMs, endMs };
  if (!report(mark) && pending.length < MAX_PENDING_MARKS) pending.push(mark);
  return true;
}

/** Sends the marks that finished before Sentry was ready; call once `initSentry()` has settled. */
export function flushPendingMarks(): void {
  if (!getGate()?.getSentryIfInit()) return;
  for (const mark of pending.splice(0)) report(mark);
}

/** Last measured cold-start ms (JS bundle → first themed shell paint). */
export function getLastColdStartMs(): number | null {
  return lastColdStartMs;
}

/** Test-only: replaces the lazily required `./sentry` module (a CommonJS `require` cannot be mocked). */
export function _setSentryGateForTests(gate: SentryGate | null): void {
  sentryGate = gate;
}

// Test-only escape hatch.
export function _resetForTests(): void {
  active.clear();
  pending.length = 0;
  lastColdStartMs = null;
}
