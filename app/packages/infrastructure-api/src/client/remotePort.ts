import type { PortTransport } from './portTransport';

/** Names of the methods of a port interface. */
type MethodName<Port> = { [Key in keyof Port]: Port[Key] extends (...args: never[]) => unknown ? Key : never }[keyof Port] & string;

export interface RemotePortOptions<Port> {
  /**
   * The methods served by the API. Omit to route every method there. While a
   * port is only partly served, list the served methods and give a `fallback`.
   */
  readonly methods?: ReadonlyArray<MethodName<Port>>;
  /** Handles every method that is not in `methods` (the adapter still in place). */
  readonly fallback?: Port;
}

/** A port method that is neither served by the API nor covered by a fallback was called. */
export class PortMethodNotRoutedError extends Error {
  constructor(port: string, method: string) {
    super(`${port}.${method} is not served by the API and no fallback adapter was given`);
    this.name = 'PortMethodNotRoutedError';
  }
}

/**
 * An implementation of an application port that forwards each method call to
 * the API. One generic adapter covers every port: the port interface is the
 * contract, so there is no per-method client code to write or keep in sync.
 *
 * @param portName The port's name on the wire (as registered by the API).
 */
export function createRemotePort<Port extends object>(
  transport: PortTransport,
  portName: string,
  options: RemotePortOptions<Port> = {},
): Port {
  const served = options.methods ? new Set<string>(options.methods) : null;
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();

  return new Proxy({} as Port, {
    get(_target, property) {
      // Promise machinery probes `then`; symbols are never port methods.
      if (typeof property !== 'string' || property === 'then') return undefined;

      if (served && !served.has(property)) {
        const fallback = options.fallback as Record<string, unknown> | undefined;
        const member = fallback?.[property];
        if (typeof member === 'function') return member.bind(fallback);
        if (member !== undefined) return member;
        return () => Promise.reject(new PortMethodNotRoutedError(portName, property));
      }

      // One stable function per method, so `port.follow === port.follow` (hooks compare identities).
      let handler = handlers.get(property);
      if (!handler) {
        handler = (...args: unknown[]) => transport.call(portName, property, args);
        handlers.set(property, handler);
      }
      return handler;
    },
  });
}
