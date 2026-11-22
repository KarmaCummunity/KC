import { describe, expect, it } from 'vitest';
import {
  canStartIdentityVerification,
  IdentityVerificationError,
  isIdentityVerificationError,
  toIdentityVerificationStatus,
} from '../identityVerification';
import { DomainError } from '../errors';

describe('toIdentityVerificationStatus', () => {
  it('keeps every known status', () => {
    for (const status of ['not_started', 'in_progress', 'review', 'verified', 'declined', 'resubmit', 'expired']) {
      expect(toIdentityVerificationStatus(status)).toBe(status);
    }
  });

  it('reads anything unknown as not started', () => {
    expect(toIdentityVerificationStatus('approved')).toBe('not_started');
    expect(toIdentityVerificationStatus(null)).toBe('not_started');
    expect(toIdentityVerificationStatus(2)).toBe('not_started');
  });
});

describe('canStartIdentityVerification', () => {
  it('offers a new session unless verified or waiting for review', () => {
    expect(canStartIdentityVerification('not_started')).toBe(true);
    expect(canStartIdentityVerification('in_progress')).toBe(true);
    expect(canStartIdentityVerification('declined')).toBe(true);
    expect(canStartIdentityVerification('resubmit')).toBe(true);
    expect(canStartIdentityVerification('expired')).toBe(true);
    expect(canStartIdentityVerification('verified')).toBe(false);
    expect(canStartIdentityVerification('review')).toBe(false);
  });
});

describe('IdentityVerificationError', () => {
  it('is a domain error with a stable code', () => {
    const error = new IdentityVerificationError('attempts_exhausted');
    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe('attempts_exhausted');
    expect(isIdentityVerificationError(error)).toBe(true);
    expect(isIdentityVerificationError(new Error('x'))).toBe(false);
  });
});
