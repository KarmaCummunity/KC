/**
 * FR-AUTH-008: request a password-reset link for an email account.
 *
 * AC1 (anti-enumeration): the caller always gets the same outcome whether or
 * not the address is registered. Only failures the user can act on — too many
 * requests, no network — are surfaced; any other provider error is swallowed.
 */
import { EMAIL_PATTERN } from '@kc/domain';
import type { IAuthService } from '../ports/IAuthService';
import { AuthError, isAuthError } from './errors';

export interface RequestPasswordResetInput {
  email: string;
  /** Where the reset link lands (the app's reset-password route). */
  redirectTo?: string;
}

/** Errors that reveal nothing about the account and that the user can act on. */
const SURFACED_CODES = new Set(['rate_limited', 'network']);

export class RequestPasswordResetUseCase {
  constructor(private readonly auth: IAuthService) {}

  async execute(input: RequestPasswordResetInput): Promise<void> {
    const email = input.email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
      throw new AuthError('invalid_email', 'invalid_email');
    }
    try {
      await this.auth.requestPasswordReset(email, { redirectTo: input.redirectTo });
    } catch (err) {
      if (isAuthError(err) && SURFACED_CODES.has(err.code)) throw err;
      // Any other outcome reads as success (AC1).
    }
  }
}
