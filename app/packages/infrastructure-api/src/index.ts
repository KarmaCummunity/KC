// @kc/infrastructure-api: the app's adapters for KC's own API (ADR-009, ADR-010).
export { createRemotePort, PortMethodNotRoutedError, type RemotePortOptions } from './client/remotePort';
export {
  createPortTransport,
  DEFAULT_PORT_TIMEOUT_MS,
  PortCallError,
  PortTimeoutError,
  type PortTransport,
  type PortTransportOptions,
} from './client/portTransport';
export { createPortErrorRegistry, PORT_ERRORS, type PortErrorRegistry, revivePortError, serializePortError } from './wire/portErrors';
export {
  type ApiErrorBody,
  decodeArgs,
  encodeArgs,
  MAX_PORT_ARGS,
  PORT_ERROR_CODE,
  type PortCallRequest,
  type PortCallResponse,
  type PortErrorWire,
  portCallPath,
} from './wire/portWire';
