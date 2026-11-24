import type { PortCatalog, PortName } from '../wire/portCatalog';
import { PORT_MANIFEST_PATH, type PortManifest, type PortRollout } from '../wire/portWire';
import { isServedTo, needsMemberId } from './portRollout';
import type { PortTransport } from './portTransport';

export interface PortRouterOptions {
  readonly transport: PortTransport;
  /** Base URL of the API, without a trailing slash. */
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
  /** How long a manifest is trusted before it is fetched again. */
  readonly manifestTtlMs?: number;
  /** Longest the app waits for a manifest; after that the adapters in place serve. */
  readonly manifestTimeoutMs?: number;
  /** The running app's version (`MAJOR.MINOR.PATCH`), or null; asked once, and only for a port served from a version on. */
  readonly getAppVersion?: () => Promise<string | null>;
  /** The signed-in member's id, or null; asked only for a port served to a share of the members. */
  readonly getMemberId?: () => Promise<string | null>;
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

/**
 * A cold start must not wait on a server that does not answer: the first data
 * call is behind this fetch. Two seconds covers a slow mobile link to a
 * healthy API.
 */
const DEFAULT_MANIFEST_TIMEOUT_MS = 2_000;

/** What the API serves of one port, and to whom. */
interface ServedPort {
  readonly methods: ReadonlySet<string>;
  readonly rollout: PortRollout | undefined;
}
type ServedPorts = ReadonlyMap<string, ServedPort>;
const NOTHING_SERVED: ServedPorts = new Map();

/** The manifest did not arrive within the time the app is willing to wait. */
class ManifestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`manifest did not answer within ${timeoutMs} ms`);
    this.name = 'ManifestTimeoutError';
  }
}

function toServedPorts(manifest: PortManifest): ServedPorts {
  return new Map(Object.entries(manifest.ports ?? {}).map(([port, methods]) => [port, { methods: new Set(methods), rollout: manifest.rollout?.[port] }]));
}

/**
 * Routes port calls between the API and the adapters in place, by the
 * manifest the API publishes (`GET /v1/ports`).
 *
 * The server decides what it serves: moving a port behind the API, or back,
 * is a server change that reaches installed app builds without an update.
 * The app never depends on the API being up to work: with no manifest, every
 * call goes to its fallback adapter, and a manifest that is slow to arrive
 * counts as none (`manifestTimeoutMs`).
 */
export function createPortRouter(options: PortRouterOptions): PortRouter {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const ttl = options.manifestTtlMs ?? DEFAULT_MANIFEST_TTL_MS;
  const timeoutMs = options.manifestTimeoutMs ?? DEFAULT_MANIFEST_TIMEOUT_MS;
  let served: ServedPorts = NOTHING_SERVED;
  let refreshAt = 0;
  let loading: Promise<void> | undefined;

  /**
   * One bounded fetch of the manifest. The request is aborted at the bound,
   * and the wait ends there even when the platform's fetch ignores the signal.
   */
  async function fetchManifest(): Promise<PortManifest> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bound = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ManifestTimeoutError(timeoutMs));
      }, timeoutMs);
    });
    const answer = (async () => {
      const response = await fetchImpl(`${options.baseUrl}${PORT_MANIFEST_PATH}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`manifest answered ${response.status}`);
      return (await response.json()) as PortManifest;
    })();
    // When the bound wins, the abandoned request's own failure must not surface as unhandled.
    answer.catch(() => undefined);
    try {
      return await Promise.race([answer, bound]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function load(): Promise<void> {
    try {
      served = toServedPorts(await fetchManifest());
      refreshAt = now() + ttl;
    } catch {
      // Keep the last manifest (or none): the adapters in place carry on.
      refreshAt = now() + RETRY_AFTER_FAILURE_MS;
    } finally {
      loading = undefined;
    }
  }

  /** The current manifest; the first call waits for it (at most the bound), later ones refresh it in the background. */
  async function servedPorts(): Promise<ServedPorts> {
    if (now() >= refreshAt) {
      loading ??= load();
      // Only the very first lookup blocks; a stale manifest is still a valid answer.
      if (served === NOTHING_SERVED) await loading;
    }
    return served;
  }

  let appVersion: Promise<string | null> | undefined;
  /** The app's version; a build's version does not change while it runs, so it is read once. */
  function readAppVersion(): Promise<string | null> {
    appVersion ??= (options.getAppVersion?.() ?? Promise.resolve(null)).catch(() => null);
    return appVersion;
  }

  /** True when the API serves `method` of `port` to whoever is using the app now. */
  async function routesToApi(port: string, method: string): Promise<boolean> {
    const entry = (await servedPorts()).get(port);
    if (!entry?.methods.has(method)) return false;
    const { rollout } = entry;
    if (!rollout) return true;
    // The version and the member's id are looked up only when the answer depends on them.
    const version = rollout.minAppVersion === undefined ? null : await readAppVersion();
    const memberId = needsMemberId(rollout) ? ((await options.getMemberId?.().catch(() => null)) ?? null) : null;
    return isServedTo(port, rollout, { memberId, appVersion: version });
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
              return (await routesToApi(name, property)) ? options.transport.call(name, property, args) : member.apply(fallback, args);
            };
            handlers.set(property, handler);
          }
          return handler;
        },
      }) as Adapter;
    },
  };
}
