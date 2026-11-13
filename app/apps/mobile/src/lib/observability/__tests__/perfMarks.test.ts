import { describe, expect, it, beforeEach, vi } from 'vitest';
import { startMark, finishMark, getLastColdStartMs, _resetForTests } from '../perfMarks';

// Vitest doesn't set EXPO_PUBLIC_SENTRY_DSN, so perfMarks' HAS_DSN gate stays
// false here. All three tests exercise the noopSpan path. The endSpan() helper
// is reviewed at the call site rather than mock-stubbed — too easy to get the
// mock harness wrong (saw it once already), and the helper is simple enough
// that the type system + code review catches the obvious bugs.

describe('perfMarks', () => {
  beforeEach(() => _resetForTests());

  it('no-ops cleanly when no mark started', () => {
    expect(() => finishMark('feed.first_render')).not.toThrow();
  });

  it('idempotent start', () => {
    startMark('app.cold_start');
    expect(() => startMark('app.cold_start')).not.toThrow();
  });

  it('returns true first, false repeat', () => {
    startMark('image.first_paint');
    expect(finishMark('image.first_paint')).toBe(true);
    expect(finishMark('image.first_paint')).toBe(false);
  });

  it('records cold start duration ms', () => {
    startMark('app.cold_start');
    finishMark('app.cold_start');
    expect(getLastColdStartMs()).toEqual(expect.any(Number));
  });

  it('does not throw when no DSN — stays fully no-op', () => {
    // process.env.EXPO_PUBLIC_SENTRY_DSN is unset in vitest, so getGate()
    // returns null on the first call and never re-tries — the SDK module
    // is never loaded. We can't observe "never loaded" directly here, but
    // we can assert the public API never throws.
    expect(() => {
      startMark('app.cold_start');
      finishMark('app.cold_start');
      startMark('feed.first_render');
      finishMark('feed.first_render');
      startMark('image.first_paint');
      finishMark('image.first_paint');
    }).not.toThrow();
  });
});

// With a DSN the SDK is not up when a mark starts (init is deferred past first paint): a mark must
// still reach Sentry, with its real start time, once the SDK is ready.
describe('perfMarks with a DSN', () => {
  const startInactiveSpan = vi.fn();
  const spanEnd = vi.fn();
  let sdkReady = false;

  async function load() {
    vi.resetModules();
    vi.stubEnv('EXPO_PUBLIC_SENTRY_DSN', 'https://key@example.test/1');
    const marks = await import('../perfMarks');
    marks._setSentryGateForTests({
      getSentryIfInit: () => (sdkReady ? ({ startInactiveSpan } as never) : null),
    });
    return marks;
  }

  beforeEach(() => {
    sdkReady = false;
    startInactiveSpan.mockReset().mockReturnValue({ end: spanEnd });
    spanEnd.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  it('sends a mark that started and finished before the SDK was ready, once it is', async () => {
    const marks = await load();
    marks.startMark('feed.first_render');
    vi.setSystemTime(new Date('2026-01-01T00:00:02Z'));
    marks.finishMark('feed.first_render');
    expect(startInactiveSpan).not.toHaveBeenCalled();

    sdkReady = true;
    marks.flushPendingMarks();

    const start = Date.parse('2026-01-01T00:00:00Z') / 1000;
    expect(startInactiveSpan).toHaveBeenCalledWith({ name: 'feed.first_render', op: 'mark', startTime: start });
    expect(spanEnd).toHaveBeenCalledWith(start + 2);
    marks.flushPendingMarks();
    expect(startInactiveSpan).toHaveBeenCalledTimes(1);
  });

  it('sends a mark at once when the SDK is already ready', async () => {
    sdkReady = true;
    const marks = await load();
    marks.startMark('post_detail.content_painted');
    marks.finishMark('post_detail.content_painted');
    expect(startInactiveSpan).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the SDK fails to create a span', async () => {
    sdkReady = true;
    startInactiveSpan.mockImplementation(() => {
      throw new Error('sdk broke');
    });
    const marks = await load();
    marks.startMark('image.first_paint');
    expect(() => marks.finishMark('image.first_paint')).not.toThrow();
  });
});
