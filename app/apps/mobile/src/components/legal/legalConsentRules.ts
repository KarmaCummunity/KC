import type { LegalPendingItem } from '@kc/domain';
import type { LegalConsentMode } from './LegalConsentScreen';

/** Minimum age at launch (#1450). Sign-up requires an explicit 18+ confirmation. */
export const MIN_SIGNUP_AGE = 18;

/** Grace period between a legal-document update taking effect and the blocking consent screen. */
const LEGAL_UPDATE_GRACE_DAYS = 7;
const DAY_MS = 86_400_000;

/** Display-only countdown; the server decides when the banner turns into the blocking screen. */
export function legalUpdateDaysRemaining(
  pending: readonly Pick<LegalPendingItem, 'currentEffectiveDate'>[],
  now: number = Date.now(),
): number {
  if (pending.length === 0) return LEGAL_UPDATE_GRACE_DAYS;
  const earliest = Math.min(...pending.map((p) => p.currentEffectiveDate.getTime()));
  const elapsedDays = Math.floor((now - earliest) / DAY_MS);
  return Math.max(0, LEGAL_UPDATE_GRACE_DAYS - elapsedDays);
}

export function canSubmitLegalConsent(input: {
  readonly mode: LegalConsentMode;
  readonly pending: readonly Pick<LegalPendingItem, 'docType'>[];
  readonly accepted: Readonly<Record<string, boolean>>;
  readonly ageConfirmed: boolean;
}): boolean {
  const docsOk = input.pending.every((p) => input.accepted[p.docType]);
  if (input.mode === 'signup') return docsOk && input.ageConfirmed;
  return docsOk;
}
