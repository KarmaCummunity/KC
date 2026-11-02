// Global JS error protection (KC#1410).
//
// React error boundaries only see render errors. An exception thrown from an
// event handler, a timer or an async callback reaches React Native's global
// handler instead, and in a release build the default handler hands a *fatal*
// error to the native side, which terminates the app. This module installs:
//
//   1. an `ErrorUtils` global handler that reports every uncaught error and,
//      for a fatal one in a release build, shows the recoverable fallback
//      (`UncaughtErrorGate`) instead of letting the native side crash;
//   2. a Hermes unhandled-promise-rejection tracker, so a forgotten `catch`
//      is reported rather than silently dropped.
//
// Install order matters: `installGlobalErrorHandlers` runs after Sentry init,
// so Sentry's own handler (when a DSN is configured) is the "previous" one we
// delegate to for the non-fatal / dev paths. The fatal release path reports
// through Sentry itself and never calls the previous handler, because that
// chain ends in the native crash we are avoiding.
import { Platform } from 'react-native';
import type { ErrorUtils as ErrorUtilsLike } from 'react-native';
import { getSentryIfInit } from './sentry';

/** Receives a fatal uncaught error and shows the recoverable screen. */
export type UncaughtErrorSink = (error: Error) => void;

/** Subset of `HermesInternal` used for promise rejection tracking. */
export type RejectionTrackerHost = {
  hasPromise?: () => boolean;
  enablePromiseRejectionTracker?: (options: {
    allRejections: boolean;
    onUnhandled: (id: number, rejection: unknown) => void;
    onHandled: (id: number) => void;
  }) => void;
};

type GlobalHost = {
  ErrorUtils?: ErrorUtilsLike;
  HermesInternal?: RejectionTrackerHost;
};

/** Normalises any thrown value (string, object, undefined) into an `Error`. */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string') return new Error(value);
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error(String(value));
  }
}

/** Reports an uncaught error to Sentry (when initialised). Never throws. */
export function reportUncaughtError(
  error: Error,
  kind: 'onerror' | 'onunhandledrejection',
  fatal: boolean,
): void {
  if (__DEV__) console.error(`[uncaught:${kind}]`, error);
  try {
    getSentryIfInit()?.captureException(error, {
      level: fatal ? 'fatal' : 'error',
      tags: { boundary: 'global', kind },
    });
  } catch {
    /* reporting must never throw inside the global handler */
  }
}

/**
 * Wraps the current `ErrorUtils` global handler. Returns false when the host
 * has no `ErrorUtils` (react-native-web), where the browser already keeps the
 * page alive and Sentry's browser SDK owns `window.onerror`.
 */
export function installUncaughtErrorHandler(
  showFallback: UncaughtErrorSink,
  host: GlobalHost = globalThis as GlobalHost,
): boolean {
  const errorUtils = host.ErrorUtils;
  if (!errorUtils) return false;
  const previous = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((raw: unknown, isFatal?: boolean) => {
    // Dev keeps the RedBox / LogBox experience; a non-fatal error is only
    // logged by the default handler, so the previous chain is safe to run.
    if (__DEV__ || !isFatal) {
      previous(raw, isFatal);
      return;
    }
    const error = toError(raw);
    reportUncaughtError(error, 'onerror', true);
    showFallback(error);
  });
  return true;
}

/**
 * Tracks unhandled promise rejections on Hermes. Returns false when the
 * runtime exposes no tracker (web, or a non-Hermes engine); there a rejection
 * never crashes the app, so nothing is lost beyond the report.
 */
export function installUnhandledRejectionTracker(
  host: GlobalHost = globalThis as GlobalHost,
): boolean {
  const hermes = host.HermesInternal;
  if (!hermes?.enablePromiseRejectionTracker || !hermes.hasPromise?.()) return false;
  hermes.enablePromiseRejectionTracker({
    allRejections: true,
    onUnhandled: (_id, rejection) => reportUncaughtError(toError(rejection), 'onunhandledrejection', false),
    onHandled: () => undefined,
  });
  return true;
}

/** Installs both protections. Call once, after Sentry init has settled. */
export function installGlobalErrorHandlers(showFallback: UncaughtErrorSink): void {
  if (Platform.OS === 'web') return;
  installUncaughtErrorHandler(showFallback);
  installUnhandledRejectionTracker();
}
