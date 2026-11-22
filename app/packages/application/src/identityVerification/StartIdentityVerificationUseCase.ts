import {
  BackendRuleError,
  IDENTITY_VERIFICATION_CONSENT_VERSION,
  IdentityVerificationError,
  type IdentityVerificationErrorCode,
} from '@kc/domain';
import type { IIdentityVerificationService, IdentityVerificationSession } from '../ports/IIdentityVerificationService';

// FR-VERIFY-004 AC2, FR-VERIFY-005 AC3, FR-VERIFY-007 — record consent, then open a provider session.

export interface StartIdentityVerificationInput {
  /** The separate, unticked-by-default biometric-processing checkbox (FR-VERIFY-004 AC2). */
  readonly consentGiven: boolean;
}

/** Server refusal reasons and the member-facing error each one becomes. */
const REASON_TO_CODE: Readonly<Record<string, IdentityVerificationErrorCode>> = {
  consent_required: 'consent_required',
  already_verified: 'already_verified',
  verification_attempts_exhausted: 'attempts_exhausted',
  manual_review_only: 'manual_review_only',
  account_not_active: 'account_not_active',
};

/** Translates a port failure to an `IdentityVerificationError`; an unknown failure is `unavailable`. */
function toVerificationError(error: unknown): IdentityVerificationError {
  if (error instanceof IdentityVerificationError) return error;
  if (error instanceof BackendRuleError) {
    return new IdentityVerificationError(REASON_TO_CODE[error.reason] ?? 'unavailable', error);
  }
  // A missing backend (BackendUnavailableError), a network or provider failure: try again later.
  return new IdentityVerificationError('unavailable', error);
}

export class StartIdentityVerificationUseCase {
  constructor(private readonly service: IIdentityVerificationService) {}

  /** Returns the hosted-flow session, or throws `IdentityVerificationError`. */
  async execute(input: StartIdentityVerificationInput): Promise<IdentityVerificationSession> {
    // Without explicit consent the flow does not start, and nothing is sent to the server.
    if (!input.consentGiven) throw new IdentityVerificationError('consent_required');
    try {
      await this.service.acceptConsent(IDENTITY_VERIFICATION_CONSENT_VERSION);
      return await this.service.startSession();
    } catch (error) {
      throw toVerificationError(error);
    }
  }
}
