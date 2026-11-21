import type { PortCatalog, PortName } from '../wire/portCatalog';
import { PORT_MANIFEST_PATH, type PortManifest } from '../wire/portWire';
import type { PortTransport } from './portTransport';

export interface PortRouterOptions {
  readonly transport: PortTransport;
  /** Base URL of the API, without a trailing slash. */
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
  /** How long a manifest is trusted before it is fetched again. */
  readonly manifestTtlMs?: number;
  /** Clock, injected by tests. */
  readonly now?: () => number;
}

/** Wraps the app's adapters so each call goes to the API when the API serves it. */
export interface PortRouter {
  /**
   * @param name Wire name of the port in the shared catalog.
   * @param fallback The adapter in place today. It keeps serving every method
   *   the API does not list, and every method while the API cannot be reached.
   *   The result has the adapter's own type, so a composition root that holds
   *   the concrete class needs no other change.
   */
  port<Name extends PortName, Adapter extends PortCatalog[Name]>(name: Name, fallback: Adapter): Adapter;
}

const DEFAULT_MANIFEST_TTL_MS = 5 * 60_000;
/** After a failed fetch, the next attempt waits this long: the app must not hammer an API that is down. */
const RETRY_AFTER_FAILURE_MS = 30_000;

type ServedMethods = ReadonlyMap<string, ReadonlySet<string>>;
const NOTHING_SERVED: ServedMethods = new Map();

function toServedMethods(manifest: PortManifest): ServedMethods {
  return new Map(Object.entries(manifest.ports ?? {}).map(([port, methods]) => [port, new Set(methods)]));
}

/**
 * Routes port calls between the API and the adapters in place, by the
 * manifest the API publishes (`GET /v1/ports`).
 *
 * The server decides what it serves: moving a port behind the API, or back,
 * is a server change that reaches installed app builds without an update.
 * The app never depends on the API being up to work: with no manifest, every
 * call goes to its fallback adapter.
 */
export function createPortRouter(options: PortRouterOptions): PortRouter {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const ttl = options.manifestTtlMs ?? DEFAULT_MANIFEST_TTL_MS;
  let served: ServedMethods = NOTHING_SERVED;
  let refreshAt = 0;
  let loading: Promise<void> | undefined;

  async function load(): Promise<void> {
    try {
      const response = await fetchImpl(`${options.baseUrl}${PORT_MANIFEST_PATH}`);
      if (!response.ok) throw new Error(`manifest answered ${response.status}`);
      served = toServedMethods((await response.json()) as PortManifest);
      refreshAt = now() + ttl;
    } catch {
      // Keep the last manifest (or none): the adapters in place carry on.
      refreshAt = now() + RETRY_AFTER_FAILURE_MS;
    } finally {
      loading = undefined;
    }
  }

  /** The current manifest; the first call waits for it, later ones refresh it in the background. */
  async function servedMethods(): Promise<ServedMethods> {
    if (now() >= refreshAt) {
      loading ??= load();
      // Only the very first lookup blocks; a stale manifest is still a valid answer.
      if (served === NOTHING_SERVED) await loading;
    }
    return served;
  }

  return {
    port<Name extends PortName, Adapter extends PortCatalog[Name]>(name: Name, fallback: Adapter): Adapter {
      const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
      const local = fallback as unknown as Record<string, unknown>;

      return new Proxy(fallback as object, {
        get(target, property, receiver) {
          const member = local[property as string];
          // Only methods are routed; fields and symbols are the adapter's own.
          if (typeof property !== 'string' || typeof member !== 'function') return Reflect.get(target, property, receiver);

          let handler = handlers.get(property);
          if (!handler) {
            handler = async (...args: unknown[]) => {
              const methods = (await servedMethods()).get(name);
              return methods?.has(property) ? options.transport.call(name, property, args) : member.apply(fallback, args);
            };
            handlers.set(property, handler);
          }
          return handler;
        },
      }) as Adapter;
    },
  };
}
