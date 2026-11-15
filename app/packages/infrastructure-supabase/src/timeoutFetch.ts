// ─────────────────────────────────────────────
// Timeout Fetch Wrapper with AbortController
// Ensures hung or slow requests abort after timeoutMs
// ─────────────────────────────────────────────

export const DEFAULT_SUPABASE_TIMEOUT_MS = 25_000;

export class FetchTimeoutError extends Error {
  constructor(timeoutMs: number, url?: string) {
    super(`Request${url ? ` to ${url}` : ''} timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

export function isTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; message?: string };
  return (
    e.name === 'TimeoutError' ||
    (typeof e.message === 'string' && e.message.includes('timed out'))
  );
}

/** Storage uploads/downloads and Edge Functions can legitimately run long on slow networks. */
const LONG_RUNNING_PATHS = ['/storage/v1/', '/functions/v1/'];

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return (input as Request).url ?? '';
}

export function isLongRunningRequest(input: RequestInfo | URL): boolean {
  const url = requestUrl(input);
  return LONG_RUNNING_PATHS.some((p) => url.includes(p));
}

export function createTimeoutFetch(
  timeoutMs: number = DEFAULT_SUPABASE_TIMEOUT_MS,
  baseFetch?: typeof fetch,
): typeof fetch {
  return async function timeoutFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const fetchImpl = baseFetch ?? globalThis.fetch;
    if (timeoutMs <= 0 || timeoutMs === Infinity || isLongRunningRequest(input)) {
      return fetchImpl(input, init);
    }

    const controller = new AbortController();
    let timedOut = false;

    const callerSignal = init?.signal;
    let callerAbortHandler: (() => void) | null = null;

    if (callerSignal) {
      if (callerSignal.aborted) {
        controller.abort(callerSignal.reason);
      } else {
        callerAbortHandler = () => {
          controller.abort(callerSignal.reason);
        };
        callerSignal.addEventListener('abort', callerAbortHandler, { once: true });
      }
    }

    const timeoutId = setTimeout(() => {
      timedOut = true;
      const urlStr =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      controller.abort(new FetchTimeoutError(timeoutMs, urlStr));
    }, timeoutMs);

    try {
      const response = await fetchImpl(input, {
        ...init,
        signal: controller.signal,
      });
      return response;
    } catch (err: unknown) {
      if (timedOut) {
        const urlStr =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : (input as Request).url;
        throw new FetchTimeoutError(timeoutMs, urlStr);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
      if (callerSignal && callerAbortHandler) {
        callerSignal.removeEventListener('abort', callerAbortHandler);
      }
    }
  };
}
