// _shared/observability/core.ts
// The one Edge Function wrapper (G41, docs/architecture/target.md §5.2) and the
// explicit `reportError` hook, built from an injectable reporter so the behaviour is
// unit-tested without network. Functions import the env-configured instance from
// `mod.ts`; tests use `createObservability` directly.
//
//   withObservability(fn, handler)
//     - a throw that escapes the handler → Sentry exception (handled=false) + a
//       generic JSON 500; the thrown message never reaches the caller
//     - a 5xx response → Sentry message carrying the function, status and the
//       body's `error` code (codes only, never free text) — unless the handler
//       already called `reportError` for this request
//     - timing / cold-start log line (withTiming) on every invocation
//   reportError(err, { fn, req?, tags?, extra? })
//     - for fatal paths a handler maps to its own error response, and for
//       background jobs (EdgeRuntime.waitUntil) that run outside the wrapper

import { withTiming } from '../withTiming.ts';
import { type RequestInfo, sanitizeUrl } from './event.ts';
import { createReporter, type ReporterConfig } from './reporter.ts';

export type Handler = (req: Request) => Promise<Response>;

export interface ReportErrorOptions {
  /** Edge Function name — the Sentry `edge_function` tag and log field. */
  fn: string;
  /** The request being served, when inside a handler: dedupes the wrapper's 5xx report. */
  req?: Request;
  tags?: Record<string, string>;
  /** Non-PII diagnostic values (ids, counts). Never put request bodies or user data here. */
  extra?: Record<string, unknown>;
}

export interface Observability {
  withObservability(fnName: string, handler: Handler): Handler;
  reportError(thrown: unknown, opts: ReportErrorOptions): Promise<void>;
}

// Only identifier-shaped `error` values are forwarded as tags: free-text messages
// (Postgres errors, provider payloads) may contain user data.
const ERROR_CODE = /^[a-z0-9_.:-]{1,64}$/i;
const MAX_INSPECTED_BODY_BYTES = 4096;

function describeRequest(req: Request): RequestInfo {
  return { method: req.method, url: sanitizeUrl(req.url) };
}

function internalErrorResponse(): Response {
  return new Response(JSON.stringify({ ok: false, error: 'internal' }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Reads the `error` code out of a small JSON error body; `null` when there is none. */
export async function readErrorCode(res: Response): Promise<string | null> {
  const type = res.headers.get('content-type') ?? '';
  const length = Number(res.headers.get('content-length') ?? '0');
  if (!type.includes('json') || length > MAX_INSPECTED_BODY_BYTES) return null;
  try {
    const text = await res.clone().text();
    if (text.length > MAX_INSPECTED_BODY_BYTES) return null;
    const code = (JSON.parse(text) as { error?: unknown }).error;
    return typeof code === 'string' && ERROR_CODE.test(code) ? code : null;
  } catch {
    return null;
  }
}

export function createObservability(config: ReporterConfig): Observability {
  const reporter = createReporter(config);
  // Requests whose handler already reported; the 5xx hook skips them (no double events).
  const reported = new WeakSet<Request>();

  async function reportError(thrown: unknown, opts: ReportErrorOptions): Promise<void> {
    if (opts.req) reported.add(opts.req);
    await reporter.captureException(thrown, {
      fn: opts.fn,
      handled: true,
      tags: opts.tags,
      request: opts.req ? describeRequest(opts.req) : undefined,
      extra: opts.extra,
    });
  }

  async function reportServerError(fnName: string, req: Request, res: Response): Promise<void> {
    const code = await readErrorCode(res);
    const tags: Record<string, string> = { status: String(res.status) };
    if (code) tags.error_code = code;
    await reporter.captureMessage(
      `${fnName} responded ${res.status}${code ? ` (${code})` : ''}`,
      'error',
      { fn: fnName, handled: true, tags, request: describeRequest(req) },
    );
  }

  function withObservability(fnName: string, handler: Handler): Handler {
    const guarded: Handler = async (req) => {
      let res: Response;
      try {
        res = await handler(req);
      } catch (thrown) {
        await reporter.captureException(thrown, { fn: fnName, handled: false, request: describeRequest(req) });
        return internalErrorResponse();
      }
      if (res.status >= 500 && !reported.has(req)) await reportServerError(fnName, req, res);
      return res;
    };
    return withTiming(fnName, guarded, config.log ? { log: config.log } : {});
  }

  return { withObservability, reportError };
}
