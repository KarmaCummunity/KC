// Global JS error protection (KC#1410): a fatal uncaught error in a release
// build is reported and routed to the recoverable fallback instead of the
// native crash handler; non-fatal and dev errors keep the previous chain.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const captureException = vi.fn();
vi.mock('../sentry', () => ({ getSentryIfInit: () => ({ captureException }) }));

import {
  installUncaughtErrorHandler,
  installUnhandledRejectionTracker,
  reportUncaughtError,
  toError,
  type RejectionTrackerHost,
} from '../globalErrorHandlers';

type Handler = (error: unknown, isFatal?: boolean) => void;

/** Minimal `ErrorUtils` double that records the installed handler. */
function makeErrorUtils(previous: Handler) {
  let current: Handler = previous;
  return {
    getGlobalHandler: () => current,
    setGlobalHandler: (next: Handler) => {
      current = next;
    },
    fire: (error: unknown, isFatal?: boolean) => current(error, isFatal),
  };
}

const devFlag = globalThis as { __DEV__?: boolean };

describe('globalErrorHandlers', () => {
  beforeEach(() => {
    devFlag.__DEV__ = false;
    captureException.mockClear();
  });
  afterEach(() => {
    delete devFlag.__DEV__;
  });

  describe('toError', () => {
    it('keeps an Error and wraps a string or object', () => {
      const err = new Error('x');
      expect(toError(err)).toBe(err);
      expect(toError('boom').message).toBe('boom');
      expect(toError({ code: 1 }).message).toBe('{"code":1}');
    });
  });

  describe('installUncaughtErrorHandler', () => {
    it('shows the fallback and reports a fatal error in release, without the crash chain', () => {
      const previous = vi.fn();
      const errorUtils = makeErrorUtils(previous);
      const showFallback = vi.fn();
      expect(installUncaughtErrorHandler(showFallback, { ErrorUtils: errorUtils })).toBe(true);

      const error = new Error('fatal');
      errorUtils.fire(error, true);

      expect(previous).not.toHaveBeenCalled();
      expect(showFallback).toHaveBeenCalledWith(error);
      expect(captureException).toHaveBeenCalledWith(
        error,
        expect.objectContaining({ level: 'fatal', tags: { boundary: 'global', kind: 'onerror' } }),
      );
    });

    it('delegates a non-fatal error to the previous handler', () => {
      const previous = vi.fn();
      const errorUtils = makeErrorUtils(previous);
      const showFallback = vi.fn();
      installUncaughtErrorHandler(showFallback, { ErrorUtils: errorUtils });

      errorUtils.fire(new Error('minor'), false);

      expect(previous).toHaveBeenCalledTimes(1);
      expect(showFallback).not.toHaveBeenCalled();
      expect(captureException).not.toHaveBeenCalled();
    });

    it('delegates every error in dev so the RedBox still shows', () => {
      devFlag.__DEV__ = true;
      const previous = vi.fn();
      const errorUtils = makeErrorUtils(previous);
      const showFallback = vi.fn();
      installUncaughtErrorHandler(showFallback, { ErrorUtils: errorUtils });

      errorUtils.fire(new Error('fatal in dev'), true);

      expect(previous).toHaveBeenCalledTimes(1);
      expect(showFallback).not.toHaveBeenCalled();
    });

    it('wraps a thrown non-Error value before showing it', () => {
      const errorUtils = makeErrorUtils(vi.fn());
      const showFallback = vi.fn();
      installUncaughtErrorHandler(showFallback, { ErrorUtils: errorUtils });

      errorUtils.fire('plain string', true);

      expect(showFallback).toHaveBeenCalledWith(expect.any(Error));
      expect(showFallback.mock.calls[0][0].message).toBe('plain string');
    });

    it('is a no-op without ErrorUtils (web)', () => {
      expect(installUncaughtErrorHandler(vi.fn(), {})).toBe(false);
    });
  });

  describe('installUnhandledRejectionTracker', () => {
    it('reports an unhandled rejection through the Hermes tracker', () => {
      let tracker: Parameters<NonNullable<RejectionTrackerHost['enablePromiseRejectionTracker']>>[0] | null = null;
      const hermes: RejectionTrackerHost = {
        hasPromise: () => true,
        enablePromiseRejectionTracker: (options) => {
          tracker = options;
        },
      };
      expect(installUnhandledRejectionTracker({ HermesInternal: hermes })).toBe(true);

      tracker!.onUnhandled(1, new Error('forgotten catch'));

      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'forgotten catch' }),
        expect.objectContaining({ level: 'error', tags: { boundary: 'global', kind: 'onunhandledrejection' } }),
      );
    });

    it('is a no-op when the runtime exposes no tracker', () => {
      expect(installUnhandledRejectionTracker({})).toBe(false);
      expect(installUnhandledRejectionTracker({ HermesInternal: { hasPromise: () => false } })).toBe(false);
    });
  });

  describe('reportUncaughtError', () => {
    it('never throws when the reporter fails', () => {
      captureException.mockImplementationOnce(() => {
        throw new Error('sentry down');
      });
      expect(() => reportUncaughtError(new Error('x'), 'onerror', true)).not.toThrow();
    });
  });
});
