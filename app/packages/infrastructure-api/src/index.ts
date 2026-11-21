// @kc/infrastructure-api: the app's adapters for KC's own API (ADR-009, ADR-010).
export { createPortRouter, type PortRouter, type PortRouterOptions } from './client/portRouter';
export { createRemotePort, PortMethodNotRoutedError, type RemotePortOptions } from './client/remotePort';
export {
  createPortTransport,
  DEFAULT_PORT_TIMEOUT_MS,
  PortCallError,
  PortTimeoutError,
  type PortTransport,
  type PortTransportOptions,
} from './client/portTransport';
export type { PortCatalog, PortName } from './wire/portCatalog';
export { createPortErrorRegistry, PORT_ERRORS, type PortErrorRegistry, revivePortError, serializePortError } from './wire/portErrors';
export {
  type ApiErrorBody,
  decodeArgs,
  encodeArgs,
  markDates,
  MAX_PORT_ARGS,
  PORT_ERROR_CODE,
  PORT_MANIFEST_PATH,
  type PortCallRequest,
  type PortCallResponse,
  type PortErrorWire,
  type PortManifest,
  portCallPath,
  reviveDates,
} from './wire/portWire';
