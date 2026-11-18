import { describe, expect, it } from 'vitest';
import type { IdentityVerificationSummary } from '@kc/domain';
import { identityStartErrorKey, identityStatusText } from '../identityStatusText';
import i18n from '../../../i18n';

const summary = (status: IdentityVerificationSummary['status'], reasonCode: string | null = null): IdentityVerificationSummary =>
  ({ status, reasonCode, decidedAt: null, verifiedAt: null, expiresAt: null });

describe('identityStatusText', () => {
  it('shows only the status line outside a decline or resubmit', () => {
    expect(identityStatusText(summary('in_progress'))).toEqual({ statusKey: 'verification.identity.status.in_progress', reasonKey: null });
    expect(identityStatusText(summary('review', 'x')).reasonKey).toBeNull();
  });

  it('explains a known reason and falls back to a generic one', () => {
    expect(identityStatusText(summary('declined', 'underage')).reasonKey).toBe('verification.identity.reason.underage');
    expect(identityStatusText(summary('resubmit', 'document_expired')).reasonKey).toBe('verification.identity.reason.document_expired');
    expect(identityStatusText(summary('declined', 'something_new')).reasonKey).toBe('verification.identity.reason.other');
    expect(identityStatusText(summary('declined', null)).reasonKey).toBe('verification.identity.reason.other');
  });

  it('every key it can produce exists in Hebrew and English', () => {
    const statuses = ['not_started', 'in_progress', 'review', 'verified', 'declined', 'resubmit', 'expired'] as const;
    const reasons = ['underage', 'identity_already_used', 'document_expired', 'document_not_accepted', 'face_mismatch',
      'liveness_failed', 'forgery', 'document_rejected', 'other'];
    const errors = ['consent_required', 'already_verified', 'attempts_exhausted', 'manual_review_only', 'account_not_active', 'unavailable'] as const;
    const keys = [
      ...statuses.map((s) => identityStatusText(summary(s)).statusKey),
      ...reasons.map((r) => identityStatusText(summary('declined', r)).reasonKey!),
      ...errors.map((e) => identityStartErrorKey(e)),
    ];
    for (const lng of ['he', 'en']) {
      for (const key of keys) {
        expect(i18n.getResource(lng, 'translation', key), `${lng}:${key}`).toEqual(expect.any(String));
      }
    }
  });
});
