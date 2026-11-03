/** FR-AUTH-006 / FR-AUTH-008: one password policy for sign-up and password reset. */
import { AuthError } from './errors';

export const MIN_PASSWORD_LEN = 8;

/**
 * Throws `AuthError('weak_password')` unless `password` has at least
 * `MIN_PASSWORD_LEN` characters and contains both a Latin letter and a digit.
 */
export function assertPasswordPolicy(password: string): void {
  if (password.length < MIN_PASSWORD_LEN) {
    throw new AuthError('weak_password', 'weak_password_too_short');
  }
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  if (!hasLetter || !hasDigit) {
    throw new AuthError('weak_password', 'weak_password_letter_digit');
  }
}
