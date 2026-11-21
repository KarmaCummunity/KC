/**
 * The wire format of a port call (ADR-010): the app calls a method of an
 * application port on the server and gets its result or its typed error back.
 * This file is the single definition both sides import.
 *
 *   POST /v1/ports/<port>/<method>      { "args": [ … ] }
 *   200                                 { "result": … }      (no key for `undefined`)
 *   422                                 { "error": { "code": "port_error", "requestId", "detail": { "port": PortErrorWire } } }
 *   other failures                      { "error": { "code", "requestId" } }
 *
 * Values are JSON. The one thing JSON cannot say that port signatures need is
 * "this argument was not passed" (`undefined`), which `encodeArgs` handles.
 */

/** `error.code` of a response that carries a typed port error. */
export const PORT_ERROR_CODE = 'port_error';

/** Most arguments a port method may take; a guard against oversized requests. */
export const MAX_PORT_ARGS = 16;

export interface PortCallRequest {
  readonly args: readonly unknown[];
}

export interface PortCallResponse {
  readonly result?: unknown;
}

/**
 * Body of `GET /v1/ports`: the methods the API serves right now, per port.
 * The app routes a call to the API only when its method is listed, and to its
 * own adapter otherwise, so what is served is decided on the server and can
 * change without a new app build.
 */
export interface PortManifest {
  readonly ports: Readonly<Record<string, readonly string[]>>;
}

/** Path of the manifest, relative to the API base URL. */
export const PORT_MANIFEST_PATH = '/v1/ports';

/** A typed error crossing the wire: which class, its message and its own data fields. */
export interface PortErrorWire {
  /** Registry key of the error class (its export name), not `error.name`. */
  readonly type: string;
  readonly message: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** Body of every failed call. */
export interface ApiErrorBody {
  readonly error: {
    readonly code: string;
    readonly requestId?: string;
    readonly detail?: { readonly port?: PortErrorWire };
  };
}

const NAME = /^[A-Za-z][A-Za-z0-9]*$/;

/** Path of a port call, relative to the API base URL. */
export function portCallPath(port: string, method: string): string {
  if (!NAME.test(port) || !NAME.test(method)) throw new TypeError(`invalid port call: ${port}.${method}`);
  return `/v1/ports/${port}/${method}`;
}

/** Marks an argument that was not passed; JSON would turn it into `null`. */
const UNDEFINED_ARG = { $undefined: true } as const;

function isUndefinedMarker(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { $undefined?: unknown }).$undefined === true && Object.keys(value).length === 1;
}

/**
 * Prepares arguments for JSON: trailing `undefined`s are dropped (the method's
 * defaults apply on the server) and an inner `undefined` is marked, so a
 * parameter that was skipped stays skipped instead of becoming `null`.
 */
export function encodeArgs(args: readonly unknown[]): unknown[] {
  let length = args.length;
  while (length > 0 && args[length - 1] === undefined) length -= 1;
  return args.slice(0, length).map((arg) => (arg === undefined ? UNDEFINED_ARG : arg));
}

/** Reverses `encodeArgs` on the server. */
export function decodeArgs(args: readonly unknown[]): unknown[] {
  return args.map((arg) => (isUndefinedMarker(arg) ? undefined : arg));
}
