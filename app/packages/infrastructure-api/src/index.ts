// @kc/infrastructure-api: the app's adapters for KC's own API (ADR-009, ADR-010).
export { createPortRouter, type PortRouter, type PortRouterOptions } from './client/portRouter';
export { isAtLeastVersion, isServedTo, rolloutBucket, type RolloutSubject } from './client/portRollout';
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
  type PortRollout,
  portCallPath,
  reviveDates,
} from './wire/portWire';
export {
  type ClientFrame,
  MAX_REALTIME_FRAME_BYTES,
  type PresenceMember,
  REALTIME_CLOSE,
  REALTIME_EXTENSIONS,
  REALTIME_PATH,
  type RealtimeErrorCode,
  type RealtimeExtension,
  type ServerFrame,
} from './wire/realtimeWire';
export { ApiRealtimeChannel, type ApiRealtimeHost, type BroadcastMessage, type ChannelStatus, createApiRealtimeHost } from './realtime/apiRealtimeHost';
export { RealtimeSocket, type RealtimeSocketOptions, type SocketLike } from './realtime/realtimeSocket';
export { type ApiStorage, type ApiStorageOptions, createApiStorage, type ObjectUpload, StorageRequestError } from './storage/apiStorage';
export {
  type DeleteObjectsRequest,
  type DeleteObjectsResponse,
  isPublicObjectUrl,
  type ObjectRef,
  PUBLIC_OBJECT_PATH,
  publicObjectName,
  publicObjectUrl,
  type SignedUrlRequest,
  type SignedUrlResponse,
  STORAGE_PATHS,
  type StorageErrorCode,
  type UploadCompleteResponse,
  type UploadGrantRequest,
  type UploadGrantResponse,
  type UploadTarget,
} from './wire/storageWire';
export { IDENTITY_PATHS, type IdentityErrorCode, type RefreshRequest, type SessionResponse, type SessionUser, type SignOutRequest } from './wire/identityWire';
export { withoutTrailingSlashes } from './wire/urlText';
