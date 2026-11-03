// _shared/observability/mod.ts
// Env-configured observability for every Edge Function (G41). Import from here:
//
//   import { reportError, withObservability } from '../_shared/observability/mod.ts';
//   serve(withObservability('my-function', handler));
//
// Reads SENTRY_* at module load, so tests import `core.ts` instead (no env access).

import { configFromEnv } from './config.ts';
import { createObservability } from './core.ts';

export type { Handler, ReportErrorOptions } from './core.ts';

const observability = createObservability(configFromEnv());

/** Wraps a handler: unhandled throws and 5xx responses are reported to Sentry. */
export const withObservability = observability.withObservability;

/** Reports a handled error (fatal paths, background jobs). Never throws. */
export const reportError = observability.reportError;
