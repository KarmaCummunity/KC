// FR-VERIFY-003 / FR-VERIFY-004 / FR-VERIFY-007 — identity verification (ID document + live selfie).
// The server (`my_identity_verification`, the identity-verification Edge Functions) owns every
// decision; these types and rules only describe what the member's own UI may show and offer.
import { DomainError } from './errors';

/** Status page states (FR-VERIFY-003 AC2). */
export type IdentityVerificationStatus =
  | 'not_started'
  | 'in_progress'
  | 'review'
  | 'verified'
  | 'declined'
  | 'resubmit'
  | 'expired';

/** The member's own verification state, as the status page shows it. Dates are ISO strings. */
export interface IdentityVerificationSummary {
  readonly status: IdentityVerificationStatus;
  /** Stable reason code of the latest decision (e.g. `underage`, `document_expired`); null when none. */
  readonly reasonCode: string | null;
  readonly decidedAt: string | null;
  readonly verifiedAt: string | null;
  readonly expiresAt: string | null;
}

/**
 * Version of the consent text the member accepts before the provider flow opens (FR-VERIFY-004 AC2).
 * Bump it whenever the consent wording in the locale files changes materially.
 */
export const IDENTITY_VERIFICATION_CONSENT_VERSION = 'v1';

const STATUSES: readonly IdentityVerificationStatus[] = [
  'not_started',
  'in_progress',
  'review',
  'verified',
  'declined',
  'resubmit',
  'expired',
];

/** Narrows an untrusted wire value to a status; anything unknown is `not_started`. */
export function toIdentityVerificationStatus(value: unknown): IdentityVerificationStatus {
  return STATUSES.includes(value as IdentityVerificationStatus) ? (value as IdentityVerificationStatus) : 'not_started';
}

/**
 * Whether the member may open a new provider session from this state. A verified member has
 * nothing to do, and a case in review waits for a person (FR-VERIFY-008); every other state
 * (including an abandoned session) may start again, within the server's attempt limits.
 */
export function canStartIdentityVerification(status: IdentityVerificationStatus): boolean {
  return status !== 'verified' && status !== 'review';
}

/** Why starting a verification was refused; each maps to a localized message on the screen. */
export type IdentityVerificationErrorCode =
  /** The member did not tick the biometric-processing consent. */
  | 'consent_required'
  /** The member is already verified (level 2 or above). */
  | 'already_verified'
  /** 3 sessions per 24 h or 5 per 30 days were used (FR-VERIFY-007 AC1). */
  | 'attempts_exhausted'
  /** Two forgery or face-mismatch declines: only staff review remains (FR-VERIFY-007 AC2). */
  | 'manual_review_only'
  /** The account is not active (pending verification, suspended, being deleted). */
  | 'account_not_active'
  /** The provider or the server could not open a session right now. */
  | 'unavailable';

export class IdentityVerificationError extends DomainError {
  readonly code: IdentityVerificationErrorCode;

  constructor(code: IdentityVerificationErrorCode, cause?: unknown) {
    super(`identity_verification:${code}`, cause === undefined ? undefined : { cause });
    this.code = code;
  }
}

export function isIdentityVerificationError(value: unknown): value is IdentityVerificationError {
  return value instanceof IdentityVerificationError;
}
