import type { TFunction } from 'i18next';
import { ChallengeError, type ChallengeErrorCode } from '@kc/domain';

/** Localized text for one challenge error code; a code without its own text gets the generic message. */
export function challengeCodeMessage(t: TFunction, code: ChallengeErrorCode): string {
  return t(`challenges.errors.${code}`, { defaultValue: t('challenges.errors.generic') });
}

/** Localized text for a failed challenge action; unknown failures get the generic message. */
export function challengeErrorMessage(t: TFunction, error: unknown): string {
  return error instanceof ChallengeError ? challengeCodeMessage(t, error.code) : t('challenges.errors.generic');
}
