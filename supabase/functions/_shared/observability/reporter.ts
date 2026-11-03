// _shared/observability/reporter.ts
// Sends events to Sentry over `fetch` and never throws (G41). Without a DSN every
// capture still writes one structured log line, so Supabase function logs keep the
// error even before the `SENTRY_DSN` secret exists on a project.

import { parseDsn, sentryAuthHeader } from './dsn.ts';
import {
  buildExceptionEvent,
  buildMessageEvent,
  type EventContext,
  type RequestInfo,
  type SentryEvent,
  type SentryLevel,
  serializeEnvelope,
} from './event.ts';

export type ReportOutcome = 'sent' | 'skipped_no_dsn' | 'failed';

export interface ReporterConfig {
  /** Full Sentry DSN; empty or malformed disables sending (logging stays on). */
  dsn?: string | null;
  /** Sentry environment, for example `prod`, `dev` or `local`. */
  environment: string;
  /** Sentry release, for example `functions@<git sha>`. */
  release?: string;
  /** Tags attached to every event (edge region, execution id). */
  tags?: Record<string, string>;
  fetchFn?: typeof fetch;
  log?: (line: unknown) => void;
  /** Upper bound for one envelope POST; the function response waits for it. */
  timeoutMs?: number;
}

export interface CaptureOptions {
  /** Edge Function name — becomes the `edge_function` tag (`function` is a reserved Sentry tag key and is dropped). */
  fn: string;
  /** False only for a throw that escaped the handler. */
  handled: boolean;
  tags?: Record<string, string>;
  request?: RequestInfo;
  extra?: Record<string, unknown>;
}

export interface Reporter {
  readonly enabled: boolean;
  captureException(thrown: unknown, opts: CaptureOptions): Promise<ReportOutcome>;
  captureMessage(message: string, level: SentryLevel, opts: CaptureOptions): Promise<ReportOutcome>;
}

const DEFAULT_TIMEOUT_MS = 2500;
const defaultLog = (line: unknown) => console.error(JSON.stringify(line));

function summarize(thrown: unknown): string {
  if (thrown instanceof Error) return `${thrown.name}: ${thrown.message}`;
  if (thrown && typeof thrown === 'object' && 'message' in thrown) return String((thrown as { message: unknown }).message);
  return String(thrown);
}

export function createReporter(config: ReporterConfig): Reporter {
  const target = parseDsn(config.dsn);
  const fetchFn = config.fetchFn ?? fetch;
  const log = config.log ?? defaultLog;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const dsn = (config.dsn ?? '').trim();

  const context = (opts: CaptureOptions): EventContext => ({
    environment: config.environment,
    release: config.release,
    tags: { ...config.tags, ...opts.tags, edge_function: opts.fn, handled: String(opts.handled) },
    request: opts.request,
    extra: opts.extra,
  });

  async function send(event: SentryEvent): Promise<ReportOutcome> {
    if (!target) return 'skipped_no_dsn';
    try {
      const res = await fetchFn(target.envelopeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-sentry-envelope',
          'X-Sentry-Auth': sentryAuthHeader(target),
        },
        body: serializeEnvelope(event, dsn),
        signal: AbortSignal.timeout(timeoutMs),
      });
      return res.ok ? 'sent' : 'failed';
    } catch {
      return 'failed';
    }
  }

  // One log line per capture: the error summary stays in Supabase logs whatever Sentry does.
  async function deliver(event: SentryEvent, opts: CaptureOptions, summary: string): Promise<ReportOutcome> {
    const outcome = await send(event);
    log({
      evt: 'edge_error',
      fn: opts.fn,
      level: event.level,
      handled: opts.handled,
      error: summary,
      status: opts.tags?.status,
      sentry: outcome,
      event_id: event.event_id,
    });
    return outcome;
  }

  return {
    enabled: target !== null,
    captureException(thrown, opts) {
      const event = buildExceptionEvent(thrown, opts.handled, context(opts));
      return deliver(event, opts, summarize(thrown));
    },
    captureMessage(message, level, opts) {
      const event = buildMessageEvent(message, level, context(opts));
      return deliver(event, opts, message);
    },
  };
}
