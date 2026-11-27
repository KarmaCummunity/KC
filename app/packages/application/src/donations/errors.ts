import type { ValidateDonationLinkEdgeErrorCode } from './validateDonationLinkContract';

/**
 * Domain error codes for donation-link flows.
 * Edge-emitted codes come from `ValidateDonationLinkEdgeErrorCode`;
 * `network` / `unknown` are client-only fallbacks (transport / unmapped).
 */
export type DonationLinkErrorCode =
  | ValidateDonationLinkEdgeErrorCode
  | 'network'
  | 'unknown';

export class DonationLinkError extends Error {
  readonly code: DonationLinkErrorCode;
  readonly cause?: unknown;
  constructor(code: DonationLinkErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'DonationLinkError';
    this.code = code;
    this.cause = cause;
    Object.setPrototypeOf(this, DonationLinkError.prototype);
  }
}

/** Safe across bundle duplicates (Metro may load @kc/application more than once). */
export function isDonationLinkError(err: unknown): err is DonationLinkError {
  if (err instanceof DonationLinkError) return true;
  if (typeof err !== 'object' || err === null) return false;
  const o = err as { name?: string; code?: unknown };
  return o.name === 'DonationLinkError' && typeof o.code === 'string';
}
