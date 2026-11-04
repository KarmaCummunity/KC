import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { CHALLENGE_ERROR_CODES, ChallengeError } from '@kc/domain';
import { localeBundle } from '../../../i18n/useLocaleBundle';
import { challengeErrorMessage } from '../challengeErrorMessage';

describe('challenge copy', () => {
  // The Hebrew / English key parity itself is enforced by src/i18n localeParity.test.
  it('has a message for every domain error code', () => {
    const { errors } = localeBundle().challenges;
    for (const code of CHALLENGE_ERROR_CODES) {
      expect(errors).toHaveProperty(code);
    }
  });
});

describe('challengeErrorMessage', () => {
  const t = ((key: string, options?: { defaultValue?: string }) =>
    key === 'challenges.errors.already_joined' ? 'joined' : (options?.defaultValue ?? key)) as unknown as TFunction;

  it('uses the message of a known domain error code', () => {
    expect(challengeErrorMessage(t, new ChallengeError('already_joined'))).toBe('joined');
  });

  it('falls back to the generic message for anything else', () => {
    expect(challengeErrorMessage(t, new Error('boom'))).toBe('challenges.errors.generic');
  });
});
