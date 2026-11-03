export type KcSupportChannelsErrorCode = 'network' | 'unknown';

/** Raised by `IKcSupportChannelsRepository` adapters when channels cannot be loaded. */
export class KcSupportChannelsError extends Error {
  readonly code: KcSupportChannelsErrorCode;
  readonly cause?: unknown;
  constructor(code: KcSupportChannelsErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'KcSupportChannelsError';
    this.code = code;
    this.cause = cause;
    Object.setPrototypeOf(this, KcSupportChannelsError.prototype);
  }
}
