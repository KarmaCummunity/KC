import * as application from '@kc/application';
import * as domain from '@kc/domain';
import type { PortErrorWire } from './portWire';

type ErrorClass = abstract new (...args: never[]) => Error;

/**
 * The error classes a port may throw across the wire, keyed by a name that is
 * the same in the server build and in a minified app build.
 */
export type PortErrorRegistry = ReadonlyMap<string, ErrorClass>;

function isErrorClass(value: unknown): value is ErrorClass {
  return typeof value === 'function' && value.prototype instanceof Error;
}

/**
 * Builds a registry from module namespaces: every exported `Error` subclass,
 * keyed by its export name. Export names survive minification; `constructor.name`
 * does not, which is why it is not the key.
 */
export function createPortErrorRegistry(...modules: ReadonlyArray<Readonly<Record<string, unknown>>>): PortErrorRegistry {
  const registry = new Map<string, ErrorClass>();
  for (const module of modules) {
    for (const [exportName, value] of Object.entries(module)) {
      if (isErrorClass(value)) registry.set(exportName, value);
    }
  }
  return registry;
}

/** Every typed error of the domain and application packages. */
export const PORT_ERRORS: PortErrorRegistry = createPortErrorRegistry(domain, application);

/** Never sent: `cause` and `stack` can carry server internals. */
const PRIVATE_FIELDS = new Set(['cause', 'stack', 'message']);

/** Registry key of the class `error` is an instance of (its exact class, else the nearest registered ancestor). */
function typeOf(error: Error, registry: PortErrorRegistry): string | null {
  let best: { type: string; depth: number } | null = null;
  for (const [type, errorClass] of registry) {
    if (!(error instanceof errorClass)) continue;
    // The most derived matching class has the longest prototype chain.
    let depth = 0;
    for (let proto: unknown = errorClass.prototype; proto; proto = Object.getPrototypeOf(proto)) depth += 1;
    if (!best || depth > best.depth) best = { type, depth };
  }
  return best?.type ?? null;
}

/**
 * Turns a thrown error into its wire form, or null when it is not a
 * registered port error (an unexpected failure, which must stay on the server).
 */
export function serializePortError(error: unknown, registry: PortErrorRegistry = PORT_ERRORS): PortErrorWire | null {
  if (!(error instanceof Error)) return null;
  const type = typeOf(error, registry);
  if (!type) return null;
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(error)) {
    if (!PRIVATE_FIELDS.has(key) && typeof value !== 'function') fields[key] = value;
  }
  return { type, message: error.message, fields };
}

/**
 * Rebuilds the error on the receiving side: an instance of the same class
 * (so `instanceof` and `.code` checks behave as with a local adapter) with the
 * same message and data fields. The constructor is not called: classes take
 * different arguments, and the fields already hold what it would have set.
 */
export function revivePortError(wire: PortErrorWire, registry: PortErrorRegistry = PORT_ERRORS): Error {
  const errorClass = registry.get(wire.type);
  if (!errorClass) return new Error(wire.message);
  const error = Object.create(errorClass.prototype) as Error;
  Object.defineProperty(error, 'message', { value: wire.message, writable: true, configurable: true, enumerable: false });
  Object.assign(error, wire.fields);
  // Point the stack at where the app received the error; the server's stack never travels.
  (Error as { captureStackTrace?: (target: object) => void }).captureStackTrace?.(error);
  return error;
}
