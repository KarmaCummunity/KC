// FR-VERIFY-003 AC2 — which message the status page shows for a verification state.
// Pure mapping to i18n keys, so the screen stays free of branching and the rule is unit-tested.
import type { IdentityVerificationSummary } from '@kc/domain';
import type { IdentityStartErrorCode } from '../../hooks/useIdentityVerification';

/** Decline / resubmit reasons that have their own plain-language explanation. */
const KNOWN_REASONS = new Set([
  'underage',
  'identity_already_used',
  'document_expired',
  'document_not_accepted',
  'face_mismatch',
  'liveness_failed',
  'forgery',
  'document_rejected',
]);

export interface IdentityStatusText {
  /** Key of the status line. */
  readonly statusKey: string;
  /** Key of the reason and what to do; null when the status needs none. */
  readonly reasonKey: string | null;
}

export function identityStatusText(summary: IdentityVerificationSummary): IdentityStatusText {
  const statusKey = `verification.identity.status.${summary.status}`;
  if (summary.status !== 'declined' && summary.status !== 'resubmit') return { statusKey, reasonKey: null };
  const reason = summary.reasonCode && KNOWN_REASONS.has(summary.reasonCode) ? summary.reasonCode : 'other';
  return { statusKey, reasonKey: `verification.identity.reason.${reason}` };
}

/** Key of the message for a refused start. */
export function identityStartErrorKey(code: IdentityStartErrorCode): string {
  return `verification.identity.startError.${code}`;
}
