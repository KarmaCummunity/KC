import type { LegalPendingItem } from '@kc/domain';
import type { LegalConsentMode } from './LegalConsentScreen';

/** Minimum age at launch (#1450). Sign-up requires an explicit 18+ confirmation. */
export const MIN_SIGNUP_AGE = 18;

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
