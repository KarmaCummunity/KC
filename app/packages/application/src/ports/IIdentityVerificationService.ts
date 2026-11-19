// app/packages/application/src/ports/IIdentityVerificationService.ts
import type { IdentityVerificationSummary } from '@kc/domain';

/** A provider-hosted verification flow the member opens in the in-app browser (FR-VERIFY-005 AC2). */
export interface IdentityVerificationSession {
  /** HTTPS address of the provider's hosted flow. The client never holds a provider key. */
  readonly hostedUrl: string;
}

/**
 * FR-VERIFY-010 AC1 — the member's seam to identity verification. The session is created by the
 * server (Edge Function `identity-verification-session`); the result arrives by the provider's
 * webhook, so nothing here can set a verification level.
 *
 * Refusals are thrown as `BackendRuleError` with the server's stable reason
 * (`consent_required`, `already_verified`, `verification_attempts_exhausted`, …); the use cases
 * translate them to `IdentityVerificationError`.
 */
export interface IIdentityVerificationService {
  /** The signed-in member's own verification state. */
  getStatus(): Promise<IdentityVerificationSummary>;
  /** Records consent to biometric processing for the given consent text version; repeating it is harmless. */
  acceptConsent(version: string): Promise<void>;
  /** Opens a provider session for the signed-in member. */
  startSession(): Promise<IdentityVerificationSession>;
}
