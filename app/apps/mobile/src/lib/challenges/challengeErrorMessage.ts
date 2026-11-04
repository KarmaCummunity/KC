import type { TFunction } from 'i18next';
import { ChallengeError } from '@kc/domain';

/** Localized text for a failed challenge action; unknown failures get the generic message. */
export function challengeErrorMessage(t: TFunction, error: unknown): string {
  if (error instanceof ChallengeError) {
    return t(`challenges.errors.${error.code}`, { defaultValue: t('challenges.errors.generic') });
  }
  return t('challenges.errors.generic');
}
