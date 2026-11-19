// identity-verification-session — opens a provider-hosted verification flow for the caller
// (FR-VERIFY-005 AC3). The member is taken from their verified JWT, never from the body. The
// database checks consent, level and attempt limits (api_identity_verification_begin) before
// the provider is called, so a refused member costs nothing. Only the hosted URL is returned;
// the provider key never leaves the server.
//
// POST → 200 { url } · 401 { error: 'unauthorized' } · 409 { error: <refusal reason> }
//        · 502 { error: 'provider_unavailable' } · 500 { error: 'internal' }

import { corsHeaders, isAllowedOrigin } from '../_shared/cors.ts';
import { type IdentityProvider, RefusalError } from '../_shared/identity/provider.ts';

/** Hosted-flow language: KC is Hebrew-first (MVP). */
const FLOW_LANGUAGE = 'he';

export interface Consent {
  readonly version: string;
  /** ISO timestamp. */
  readonly acceptedAt: string;
}

export interface SessionHandlerDeps {
  /** The caller's user id from a verified JWT, or null. */
  readonly authenticate: (req: Request) => Promise<string | null>;
  /** Opens an attempt; throws RefusalError with the database's reason when refused. */
  readonly begin: (userId: string, providerSlug: string) => Promise<string>;
  /** The member's latest consent; begin() already guarantees one exists. */
  readonly latestConsent: (userId: string) => Promise<Consent | null>;
  /** Attaches the provider session id to the attempt. */
  readonly setSession: (attemptId: string, providerSessionId: string) => Promise<void>;
  readonly provider: IdentityProvider;
  /** Receives an infrastructure failure; the response never carries its cause. */
  readonly report: (error: unknown, req: Request) => Promise<void>;
}

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

export function createSessionHandler(deps: SessionHandlerDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    const origin = req.headers.get('origin');
    if (req.method === 'OPTIONS') {
      return isAllowedOrigin(origin)
        ? new Response('ok', { status: 200, headers: corsHeaders(origin) })
        : json({ error: 'origin_not_allowed' }, 403);
    }
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const headers = isAllowedOrigin(origin) ? corsHeaders(origin) : {};

    const userId = await deps.authenticate(req);
    if (!userId) return json({ error: 'unauthorized' }, 401, headers);

    let attemptId: string;
    try {
      attemptId = await deps.begin(userId, deps.provider.slug);
    } catch (error) {
      if (error instanceof RefusalError) return json({ error: error.reason }, 409, headers);
      await deps.report(error, req);
      return json({ error: 'internal' }, 500, headers);
    }

    try {
      const consent = await deps.latestConsent(userId);
      if (!consent) return json({ error: 'consent_required' }, 409, headers);
      const session = await deps.provider.createSession({
        attemptId,
        consentVersion: consent.version,
        consentGivenAt: consent.acceptedAt,
        language: FLOW_LANGUAGE,
      });
      await deps.setSession(attemptId, session.sessionId);
      return json({ url: session.url }, 200, headers);
    } catch (error) {
      await deps.report(error, req);
      return json({ error: 'provider_unavailable' }, 502, headers);
    }
  };
}
