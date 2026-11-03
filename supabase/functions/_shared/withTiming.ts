// HOF that wraps an Edge Function handler with timing + cold-start logging.
// Read logs via `mcp__supabase__get_logs` (service: edge-function).
// Composed by `_shared/observability` (G41): functions import `withObservability`
// from there rather than this module directly.
const MODULE_LOADED_AT = Date.now();
const COLD_START_WINDOW_MS = 200;

export type Handler = (req: Request) => Promise<Response>;
type Opts = { log?: (line: unknown) => void };

export function withTiming(fnName: string, handler: Handler, opts: Opts = {}): Handler {
  const log = opts.log ?? ((l: unknown) => console.log(JSON.stringify(l)));
  return async (req: Request): Promise<Response> => {
    const startedAt = Date.now();
    const isColdStart = startedAt - MODULE_LOADED_AT < COLD_START_WINDOW_MS;
    try {
      const res = await handler(req);
      log({ fn: fnName, invocation_ms: Date.now() - startedAt, cold_start: isColdStart, status: res.status });
      return res;
    } catch (err) {
      log({
        fn: fnName,
        invocation_ms: Date.now() - startedAt,
        cold_start: isColdStart,
        status: 500,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };
}
