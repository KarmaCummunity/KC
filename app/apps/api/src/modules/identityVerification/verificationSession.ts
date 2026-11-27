// Opens a provider-hosted verification flow for the caller (FR-VERIFY-005 AC3).
// The database checks consent, level and attempt limits
// (`api_identity_verification_begin`) before the provider is called, so a
// refused member costs nothing. Only the hosted address is returned; the
// provider key never leaves the server.
//
// Ported from `supabase/functions/identity-verification-session/handler.ts`:
// same answers, same order of checks.

import type { FunctionAnswer } from '../../platform/ports/hostedFunction';
import { type IdentityProvider, RefusalError } from './identityProvider';

/** Hosted-flow language: KC is Hebrew-first (MVP). */
const FLOW_LANGUAGE = 'he';

export interface Consent {
  readonly version: string;
  /** ISO timestamp. */
  readonly acceptedAt: string;
}

export interface SessionDeps {
  /** Opens an attempt; rejects with `RefusalError` carrying the database's reason when refused. */
  readonly begin: (userId: string, providerSlug: string) => Promise<string>;
  /** The member's latest consent; `begin` already guarantees one exists. */
  readonly latestConsent: (userId: string) => Promise<Consent | null>;
  /** Attaches the provider session id to the attempt. */
  readonly setSession: (attemptId: string, providerSessionId: string) => Promise<void>;
  readonly provider: IdentityProvider;
  /** Receives an infrastructure failure (for the log); the answer never carries its cause. */
  readonly report: (error: unknown) => void;
}

const refusal = (status: number, error: string): FunctionAnswer => ({ status, body: { error } });

/**
 * @param userId The signed-in caller, or null. The member comes from the token, never from a body.
 * @returns `200 { url }`, or `401 unauthorized`, `409 <the database's reason>`,
 *   `503 provider_unavailable` (not configured: no attempt is used),
 *   `502 provider_unavailable` (configured but failed), `500 internal`.
 */
export async function openVerificationSession(userId: string | null, deps: SessionDeps): Promise<FunctionAnswer> {
  if (!userId) return refusal(401, 'unauthorized');
  // Checked after the caller and before the database: a missing configuration must not use up
  // one of the member's limited attempts or reach the provider.
  if (!deps.provider.sessionConfigured) return refusal(503, 'provider_unavailable');

  let attemptId: string;
  try {
    attemptId = await deps.begin(userId, deps.provider.slug);
  } catch (error) {
    if (error instanceof RefusalError) return refusal(409, error.reason);
    deps.report(error);
    return refusal(500, 'internal');
  }

  try {
    const consent = await deps.latestConsent(userId);
    if (!consent) return refusal(409, 'consent_required');
    const session = await deps.provider.createSession({
      attemptId,
      consentVersion: consent.version,
      consentGivenAt: consent.acceptedAt,
      language: FLOW_LANGUAGE,
    });
    await deps.setSession(attemptId, session.sessionId);
    return { status: 200, body: { url: session.url } };
  } catch (error) {
    deps.report(error);
    return refusal(502, 'provider_unavailable');
  }
}
