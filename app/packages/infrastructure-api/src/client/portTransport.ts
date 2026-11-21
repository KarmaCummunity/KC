import { BackendRuleError } from '@kc/domain';
import { revivePortError, type PortErrorRegistry, PORT_ERRORS } from '../wire/portErrors';
import { type ApiErrorBody, encodeArgs, PORT_ERROR_CODE, type PortCallResponse, portCallPath } from '../wire/portWire';

/** Default time a port call may take before it is aborted. */
export const DEFAULT_PORT_TIMEOUT_MS = 25_000;

export interface PortTransportOptions {
  /** Base URL of the API, without a trailing slash, e.g. `https://api.example.org`. */
  readonly baseUrl: string;
  /**
   * The signed-in member's access token, or null for a signed-out visitor.
   * `forceRefresh` is true after the API rejected the token, so an expired one is replaced.
   */
  readonly getAccessToken: (forceRefresh: boolean) => Promise<string | null>;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly errors?: PortErrorRegistry;
}

/** Calls one method of a port on the API. */
export interface PortTransport {
  call(port: string, method: string, args: readonly unknown[]): Promise<unknown>;
}

/** The call did not finish in time. Named and worded like the app's other timeouts, which it detects by both. */
export class PortTimeoutError extends Error {
  constructor(timeoutMs: number, call: string) {
    super(`Request to ${call} timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

/** The API answered with a failure that is not a typed port error. */
export class PortCallError extends Error {
  constructor(
    /** The API's stable error code, e.g. `internal_error`. */
    readonly code: string,
    readonly status: number,
    /** Id of the request in the API's logs. */
    readonly requestId: string | undefined,
    call: string,
  ) {
    super(`${call} failed: ${code}`);
    this.name = 'PortCallError';
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export function createPortTransport(options: PortTransportOptions): PortTransport {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PORT_TIMEOUT_MS;
  const registry = options.errors ?? PORT_ERRORS;

  async function send(path: string, body: string, call: string, forceRefresh: boolean): Promise<Response> {
    const token = await options.getAccessToken(forceRefresh);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(`${options.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new PortTimeoutError(timeoutMs, call);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async call(port, method, args) {
      const call = `${port}.${method}`;
      const path = portCallPath(port, method);
      const body = JSON.stringify({ args: encodeArgs(args) });

      let response = await send(path, body, call, false);
      // An expired token is the common 401: refresh once and repeat the call.
      if (response.status === 401) response = await send(path, body, call, true);

      const payload = await readJson(response);
      if (response.ok) return (payload as PortCallResponse).result;

      const failure = (payload as Partial<ApiErrorBody>).error;
      const portError = failure?.code === PORT_ERROR_CODE ? failure.detail?.port : undefined;
      if (portError) throw revivePortError(portError, registry);
      // The same error the Supabase adapters raise for a signed-out caller.
      if (response.status === 401) throw new BackendRuleError('unauthenticated', `port:${call}`);
      throw new PortCallError(failure?.code ?? 'unknown_error', response.status, failure?.requestId, call);
    },
  };
}
