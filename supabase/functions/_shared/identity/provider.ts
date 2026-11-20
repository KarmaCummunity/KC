// _shared/identity/provider.ts — the provider seam of identity verification (FR-VERIFY-010 AC2).
//
// Everything provider-specific (API calls, webhook signature, payload shape) lives behind
// `IdentityProvider`, so swapping the provider changes one adapter and nothing in the app or the
// database. The rest of the pipeline speaks only `IdentityDecision`.

/** Document kinds accepted in v1 (FR-VERIFY-005 AC1). Anything else is declined. */
export type AcceptedDocumentType = 'il_id_card' | 'il_passport' | 'foreign_passport';

/** Outcomes the database applies (identity_verification_apply). */
export type IdentityOutcome = 'approved' | 'declined' | 'resubmit' | 'review';

/** A provider's decision on one session, normalized. Personal fields are used once and never stored. */
export interface IdentityDecision {
  /** The provider's own event id: the idempotency key of the webhook. */
  readonly eventId: string;
  readonly providerSessionId: string;
  /** Our attempt id, echoed back by the provider. */
  readonly attemptId: string | null;
  readonly outcome: IdentityOutcome;
  /** Stable snake_case reason of a non-approval; null when none. */
  readonly reasonCode: string | null;
  readonly documentType: AcceptedDocumentType | null;
  /** ISO 3166-1 alpha-3 issuing country. */
  readonly documentCountry: string | null;
  /** Only hashed (identity hash), never stored or logged. */
  readonly documentNumber: string | null;
  /** YYYY-MM-DD. */
  readonly documentExpiresOn: string | null;
  /** YYYY-MM-DD. */
  readonly dateOfBirth: string | null;
  /** Legal name, only compared with the profile name, never stored. */
  readonly legalNames: readonly string[];
}

export interface CreateSessionInput {
  /** KC attempt id; the provider echoes it so the webhook can find the member. */
  readonly attemptId: string;
  /** Version and time of the member's biometric-processing consent (FR-VERIFY-004 AC2). */
  readonly consentVersion: string;
  readonly consentGivenAt: string;
  /** ISO 639-1 language of the hosted flow (Hebrew by default, D-24). */
  readonly language: string;
}

export interface ProviderSession {
  readonly sessionId: string;
  /** HTTPS address of the hosted flow. */
  readonly url: string;
}

export interface IdentityProvider {
  /** Session creation has the required local credentials/configuration. No network health claim. */
  readonly sessionConfigured: boolean;
  /** Slug stored with every attempt and event (e.g. `didit`). */
  readonly slug: string;
  createSession(input: CreateSessionInput): Promise<ProviderSession>;
  /** True when the request was signed by the provider and is fresh. */
  verifyWebhook(headers: Headers, rawBody: string, nowSeconds: number): Promise<boolean>;
  /** The decision a webhook carries, or null for an event that changes nothing (e.g. "In Progress"). */
  parseWebhook(body: unknown): IdentityDecision | null;
}

/** The database refused with a stable reason (P0001), e.g. `verification_attempts_exhausted`. */
export class RefusalError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'RefusalError';
  }
}

/** The provider could not be reached or answered something unusable. */
export class ProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'ProviderError';
  }
}
