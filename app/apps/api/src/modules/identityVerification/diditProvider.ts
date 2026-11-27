// The Didit adapter of the identity provider seam (FR-VERIFY-011).
//
// API: POST https://verification.didit.me/v3/session/ with header `x-api-key`;
// the answer carries `session_id` and the hosted `url`. Webhooks are signed
// with HMAC-SHA256 (hex) of the raw body under the destination's shared secret
// in `X-Signature`, with `X-Timestamp` (Unix seconds) that must be within 5
// minutes; for 24 hours after a secret rotation the old secret's signature
// arrives in `X-Signature-Previous`. Decision fields follow the V3 webhook
// model (`decision.id_verifications[]`, `liveness_checks[]`, `face_matches[]`,
// each with `warnings`).
//
// Ported from `supabase/functions/_shared/identity/didit.ts`.

import { equalInConstantTime } from '../../platform/security/constantTime';
import type { WebhookHeaders } from '../../platform/webhooks/webhookRequest';
import { hmacHex } from './decisionPayload';
import {
  type AcceptedDocumentType,
  type CreateSessionInput,
  type IdentityDecision,
  type IdentityOutcome,
  type IdentityProvider,
  ProviderError,
  type ProviderSession,
} from './identityProvider';

export const DIDIT_SLUG = 'didit';
const DIDIT_SESSION_URL = 'https://verification.didit.me/v3/session/';
/** Maximum age of a webhook, in seconds, before it is treated as a replay. */
const MAX_WEBHOOK_AGE_SECONDS = 300;

export interface DiditConfig {
  readonly apiKey: string;
  readonly webhookSecret: string;
  /** The KYC workflow (document + liveness + face match) configured in the Didit console. */
  readonly workflowId: string;
  /** Where the hosted flow sends the member when done; optional. */
  readonly callbackUrl?: string;
  /** Injected for tests; the global fetch otherwise. */
  readonly fetch?: typeof fetch;
}

/** Session statuses that carry a decision, and the outcome each one is. Others change nothing. */
const OUTCOME_BY_STATUS: Readonly<Record<string, IdentityOutcome>> = {
  Approved: 'approved',
  Declined: 'declined',
  'In Review': 'review',
  Resubmitted: 'resubmit',
};

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
const isoDate = (value: unknown): string | null => {
  const date = text(value);
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
};

/** Didit document type + alpha-3 country → an accepted kind, or null for anything else (e.g. a driver's licence). */
export function toDocumentType(diditType: string | null, country: string | null): AcceptedDocumentType | null {
  const israeli = country === 'ISR';
  if (diditType === 'Identity Card' && israeli) return 'il_id_card';
  if (diditType === 'Passport') return israeli ? 'il_passport' : 'foreign_passport';
  return null;
}

/** Signs of a forged or tampered document among Didit risk codes. */
const FORGERY_RISK = /TAMPER|FORG|FAKE|MANIPULAT|SCREEN|PRINT|PHOTOCOPY|PORTRAIT_MISMATCH/;

/** The first error-level warning of the decision, as a stable reason code. */
export function declineReason(decision: JsonObject): string {
  const lists = ['id_verifications', 'liveness_checks', 'face_matches'] as const;
  for (const list of lists) {
    const items = Array.isArray(decision[list]) ? (decision[list] as unknown[]) : [];
    for (const item of items) {
      const warnings = isObject(item) && Array.isArray(item.warnings) ? item.warnings : [];
      for (const warning of warnings) {
        if (!isObject(warning) || warning.log_type !== 'error') continue;
        const risk = String(warning.risk ?? '').toUpperCase();
        if (warning.feature === 'FACEMATCH') return 'face_mismatch';
        if (warning.feature === 'LIVENESS') return 'liveness_failed';
        if (risk === 'DOCUMENT_EXPIRED') return 'document_expired';
        if (FORGERY_RISK.test(risk)) return 'forgery';
        return 'document_rejected';
      }
    }
  }
  return 'declined_other';
}

/** Reads one webhook body into a decision; null when it changes nothing or is not a session event. */
export function parseDiditWebhook(body: unknown): IdentityDecision | null {
  if (!isObject(body)) return null;
  const status = String(body.status);
  // `Object.hasOwn`, so a status named like an inherited property (`constructor`) is not a decision.
  const outcome = Object.hasOwn(OUTCOME_BY_STATUS, status) ? OUTCOME_BY_STATUS[status] : undefined;
  const sessionId = text(body.session_id);
  if (!outcome || !sessionId) return null;
  const decision = isObject(body.decision) ? body.decision : {};
  const idList = Array.isArray(decision.id_verifications) ? decision.id_verifications : [];
  const id = isObject(idList[0]) ? idList[0] : {};
  const country = text(id.issuing_state)?.toUpperCase() ?? null;
  const documentType = toDocumentType(text(id.document_type), country);

  let finalOutcome = outcome;
  let reasonCode: string | null = outcome === 'declined' ? declineReason(decision) : null;
  if (outcome === 'resubmit') reasonCode = 'resubmit_requested';
  if (outcome === 'approved' && !documentType) {
    // A document kind outside v1 (FR-VERIFY-005 AC1) is declined even when the provider accepted it.
    finalOutcome = 'declined';
    reasonCode = 'document_not_accepted';
  }
  return {
    // The event id is Didit's own; an event without one falls back to a key that is stable per status.
    eventId: text(body.event_id) ?? `${sessionId}:${String(body.status)}:${String(body.timestamp ?? '')}`,
    providerSessionId: sessionId,
    attemptId: text(body.vendor_data),
    outcome: finalOutcome,
    reasonCode,
    documentType,
    documentCountry: country && /^[A-Z]{3}$/.test(country) ? country : null,
    documentNumber: text(id.document_number),
    documentExpiresOn: isoDate(id.expiration_date),
    dateOfBirth: isoDate(id.date_of_birth),
    legalNames: [text(id.first_name), text(id.last_name)].filter((name): name is string => name !== null),
  };
}

/** The provider over one Didit application (kc-dev points at the provider's sandbox application). */
export function diditProvider(config: DiditConfig): IdentityProvider {
  const doFetch = config.fetch ?? ((input, init) => fetch(input, init));
  return {
    slug: DIDIT_SLUG,
    sessionConfigured: Boolean(config.apiKey.trim() && config.workflowId.trim()),

    async createSession(input: CreateSessionInput): Promise<ProviderSession> {
      const response = await doFetch(DIDIT_SESSION_URL, {
        method: 'POST',
        headers: { 'x-api-key': config.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow_id: config.workflowId,
          // Our attempt id only: no user id, name or contact detail is sent to the provider.
          vendor_data: input.attemptId,
          language: input.language,
          biometric_consent: { given_at: input.consentGivenAt, text_version: input.consentVersion },
          ...(config.callbackUrl ? { callback: config.callbackUrl } : {}),
        }),
      });
      if (!response.ok) throw new ProviderError('didit_session_failed', response.status);
      const body: unknown = await response.json().catch(() => null);
      const sessionId = isObject(body) ? text(body.session_id) : null;
      const url = isObject(body) ? text(body.url) : null;
      if (!sessionId || !url?.startsWith('https://')) throw new ProviderError('didit_session_invalid');
      return { sessionId, url };
    },

    verifyWebhook(headers: WebhookHeaders, rawBody: string, nowSeconds: number): boolean {
      // `Number(null)` is 0, which is far outside the window: a missing timestamp fails like an old one.
      const timestamp = Number(headers.get('x-timestamp'));
      if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > MAX_WEBHOOK_AGE_SECONDS) return false;
      if (!config.webhookSecret) return false;
      const expected = hmacHex(config.webhookSecret, rawBody);
      const given = [headers.get('x-signature'), headers.get('x-signature-previous')];
      return given.some((signature) => signature !== null && equalInConstantTime(signature.toLowerCase(), expected));
    },

    parseWebhook: parseDiditWebhook,
  };
}
