// Turns a provider decision into the payload the database applies
// (`identity_verification_apply`, type `identity.decided`).
//
// Two personal fields are consumed here and dropped: the document number
// becomes a keyed hash (FR-VERIFY-006 AC4: one person, one account) and the
// legal name becomes a yes/no match against the profile name (AC5). Neither
// leaves this module in clear.
//
// Ported from `supabase/functions/_shared/identity/decisionPayload.ts`.

import { createHmac } from 'node:crypto';
import type { IdentityDecision } from './identityProvider';

/** HMAC-SHA256 of `text` under `key`, lowercase hex. */
export function hmacHex(key: string, text: string): string {
  return createHmac('sha256', key).update(text).digest('hex');
}

/**
 * The identity key of a document: country plus number, with spacing, dashes and letter case
 * removed so one card read twice yields the same hash.
 */
export function identityKey(country: string, documentNumber: string): string {
  return `${country.toUpperCase()}:${documentNumber.toUpperCase().replace(/[^0-9A-Z]/g, '')}`;
}

/** Lowercase name words without accents or punctuation; Hebrew letters are kept as they are. */
function nameTokens(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((token) => token.length > 1);
}

/**
 * Whether the profile name shares a word with the legal name. Null when either is unknown.
 * A loose rule on purpose: a mismatch never blocks, it is only a trust signal (AC5), and a
 * Hebrew display name against a Latin passport name is expected to read as no match.
 */
export function namesMatch(profileName: string | null, legalNames: readonly string[]): boolean | null {
  const profile = new Set(nameTokens(profileName ?? ''));
  const legal = nameTokens(legalNames.join(' '));
  if (profile.size === 0 || legal.length === 0) return null;
  return legal.some((token) => profile.has(token));
}

/** The normalized `identity.decided` payload; an approval carries the identity hash. */
export function toDecisionPayload(decision: IdentityDecision, hashKey: string, profileName: string | null): Record<string, unknown> {
  let outcome = decision.outcome;
  let reasonCode = decision.reasonCode;
  let identityHash: string | null = null;
  if (outcome === 'approved') {
    if (decision.documentCountry && decision.documentNumber) {
      identityHash = hmacHex(hashKey, identityKey(decision.documentCountry, decision.documentNumber));
    } else {
      // Without a document number the one-account rule cannot be checked: a person decides.
      outcome = 'review';
      reasonCode = 'document_number_missing';
    }
  }
  return {
    type: 'identity.decided',
    provider_session_id: decision.providerSessionId,
    outcome,
    reason_code: reasonCode,
    document_type: decision.documentType,
    document_country: decision.documentCountry,
    document_expires_on: decision.documentExpiresOn,
    date_of_birth: decision.dateOfBirth,
    name_match: namesMatch(profileName, decision.legalNames),
    identity_hash: identityHash,
  };
}
